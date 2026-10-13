from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_student
from app.models.student import Student
from app.models.event import Event
from app.schemas.student import StudentRead, StudentProfileUpdate

router = APIRouter(prefix="/me", tags=["Student Profile"])


@router.get("", response_model=StudentRead)
def get_current_profile(
    current_student: Student = Depends(get_current_student),
):
    """
    GET /api/me
    Retrieves the authenticated student's profile from PostgreSQL.
    """
    return StudentRead.model_validate(current_student)


@router.put("", response_model=StudentRead)
def update_current_profile(
    payload: StudentProfileUpdate,
    request: Request,
    current_student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    PUT /api/me
    Updates permitted profile fields (name, course, email) in PostgreSQL.
    Strictly forbids modifying student ID, password hash, role, or active status.
    All inputs are validated and sanitized on the server.
    """
    client_ip = request.client.host if request.client else "127.0.0.1"

    # Server-side validation
    if payload.name is not None:
        trimmed_name = payload.name.strip()
        if not trimmed_name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Student name cannot be empty.",
            )
        current_student.name = trimmed_name

    if payload.course is not None:
        current_student.course = payload.course.strip()

    if payload.email is not None:
        current_student.email = payload.email.strip()

    db.add(current_student)
    db.commit()
    db.refresh(current_student)

    # Record profile update audit event in PostgreSQL
    try:
        event = Event(
            event_type="PROFILE_UPDATED",
            student_id=current_student.id,
            ip_address=client_ip,
            payload={
                "name": current_student.name,
                "course": current_student.course,
                "email": current_student.email,
            },
        )
        db.add(event)
        db.commit()
    except Exception:
        db.rollback()

    return StudentRead.model_validate(current_student)
