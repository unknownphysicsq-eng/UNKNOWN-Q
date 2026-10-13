from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.dependencies import (
    check_login_rate_limit,
    record_failed_login,
    clear_login_rate_limit,
    get_current_student,
)
from app.models.student import Student
from app.models.event import Event
from app.schemas.student import (
    LoginRequest,
    TokenResponse,
    StudentRead,
    StudentUpdate,
)
from app.security import (
    verify_password,
    create_access_token,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Authenticate a student or administrator using verified PostgreSQL database records.
    - Enforces Redis rate-limiting (max 5 failed attempts in 60s)
    - Verifies password against bcrypt hash
    - Returns signed JWT access token with student profile
    - STRICT: Rejects arbitrary / unknown credentials
    """
    client_ip = request.client.host if request.client else "127.0.0.1"
    student_id = payload.student_id.strip()

    # 1. Enforce Redis Login Rate Limiting
    check_login_rate_limit(student_id=student_id, client_ip=client_ip)

    # 2. Query Student from PostgreSQL
    student = db.query(Student).filter(Student.id == student_id).first()

    # 3. Validate student existence and hashed password
    if not student or not verify_password(payload.password, student.password_hash):
        # Record failed attempt in Redis & Event log
        record_failed_login(student_id=student_id, client_ip=client_ip)
        try:
            event = Event(
                event_type="LOGIN_FAILED",
                student_id=student.id if student else None,
                ip_address=client_ip,
                payload={"attempted_id": student_id, "reason": "invalid_credentials"},
            )
            db.add(event)
            db.commit()
        except Exception:
            db.rollback()

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid student ID or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check active status
    if not student.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your student account is currently suspended. Please contact admissions.",
        )

    # 4. Authentication Succeeded: Reset rate limiter in Redis
    clear_login_rate_limit(student_id=student_id, client_ip=client_ip)

    # Record login audit event in PostgreSQL
    try:
        event = Event(
            event_type="LOGIN_SUCCESS",
            student_id=student.id,
            ip_address=client_ip,
            payload={"role": student.role, "course": student.course},
        )
        db.add(event)
        db.commit()
    except Exception:
        db.rollback()

    # 5. Create Signed JWT Access Token with claims
    token_claims = {
        "sub": student.id,
        "name": student.name,
        "course": student.course or "",
        "role": student.role,
    }
    access_token = create_access_token(data=token_claims)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=StudentRead.model_validate(student),
    )


@router.get("/me", response_model=StudentRead)
def get_my_profile(
    current_student: Student = Depends(get_current_student),
):
    """
    Protected endpoint: Returns the profile of the currently authenticated student
    derived from the validated JWT token and PostgreSQL record.
    """
    return StudentRead.model_validate(current_student)


@router.put("/me", response_model=StudentRead)
def update_my_profile(
    payload: StudentUpdate,
    current_student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Protected endpoint: Updates profile details for the authenticated student in PostgreSQL.
    """
    if payload.name is not None:
        current_student.name = payload.name.strip()
    if payload.course is not None:
        current_student.course = payload.course.strip()
    if payload.email is not None:
        current_student.email = payload.email.strip()

    db.add(current_student)
    db.commit()
    db.refresh(current_student)

    return StudentRead.model_validate(current_student)
