from datetime import datetime, timezone, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import require_admin
from app.models.student import Student
from app.models.event import Event
from app.models.application import Application
from app.schemas.student import StudentCreate, StudentRead
from app.schemas.event import EventRead
from app.services.queue_manager import queue_manager
from app.security import hash_password

router = APIRouter(prefix="/admin", tags=["Admin Portal"])


@router.get("/students", response_model=List[StudentRead])
def list_all_students(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    role: Optional[str] = None,
    admin: Student = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Admin-only endpoint: List students registered in the PostgreSQL database.
    """
    query = db.query(Student)
    if role:
        query = query.filter(Student.role == role)
    return query.offset(offset).limit(limit).all()


@router.post("/students", response_model=StudentRead, status_code=status.HTTP_201_CREATED)
def create_student_account(
    payload: StudentCreate,
    admin: Student = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Admin-only endpoint: Create a new student or administrator with bcrypt-hashed credentials.
    """
    existing = db.query(Student).filter(Student.id == payload.id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Student ID '{payload.id}' is already registered.",
        )

    new_student = Student(
        id=payload.id.strip(),
        name=payload.name.strip(),
        email=payload.email.strip() if payload.email else None,
        course=payload.course.strip() if payload.course else None,
        role=payload.role or "student",
        password_hash=hash_password(payload.password),
        is_active=True,
    )
    db.add(new_student)
    db.commit()
    db.refresh(new_student)

    return new_student


@router.get("/events", response_model=List[EventRead])
def list_system_events(
    limit: int = Query(50, ge=1, le=200),
    admin: Student = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Admin-only endpoint: Inspect real-time audit and telemetry logs.
    """
    return db.query(Event).order_by(Event.created_at.desc()).limit(limit).all()


@router.get("/stats")
def get_admin_stats(
    admin: Student = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Admin-only endpoint: Real metrics aggregated from PostgreSQL and Redis:
    - total_students: registered student count
    - active_students: active students
    - waiting_students: real Redis queue length
    - blocked_requests: rate-limit rejections logged in events table
    - total_submissions: application submissions recorded
    """
    total_students = db.query(Student).filter(Student.role == "student").count()
    active_students = db.query(Student).filter(Student.role == "student", Student.is_active == True).count()
    waiting_students = queue_manager.get_total_waiting_count()
    blocked_requests = db.query(Event).filter(
        Event.event_type.in_(["RATE_LIMIT_REJECTION", "LOGIN_RATE_LIMITED"])
    ).count()
    total_submissions = db.query(Application).count()

    return {
        "total_students": total_students,
        "active_students": active_students,
        "waiting_students": waiting_students,
        "blocked_requests": blocked_requests,
        "total_submissions": total_submissions,
        "admin_name": admin.name,
        "admin_id": admin.id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/traffic")
def get_admin_traffic(
    admin: Student = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Admin-only endpoint: Computes 12-interval live traffic points and event breakdown
    generated from timestamped PostgreSQL audit events over the last 60 minutes.
    """
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=1)
    bucket_count = 12
    bucket_delta = timedelta(minutes=5)

    events = db.query(Event).filter(Event.created_at >= window_start).all()
    points = [0] * bucket_count
    labels = []

    for i in range(bucket_count):
        bucket_time = window_start + i * bucket_delta
        labels.append(bucket_time.strftime("%H:%M"))

    breakdown = {
        "queue_joins": 0,
        "admissions": 0,
        "submissions": 0,
        "blocked_requests": 0,
        "logins": 0,
    }

    for ev in events:
        t_type = ev.event_type.upper() if ev.event_type else ""
        if t_type == "QUEUE_JOIN":
            breakdown["queue_joins"] += 1
        elif t_type == "QUEUE_ADMISSION":
            breakdown["admissions"] += 1
        elif "SUBMI" in t_type:
            breakdown["submissions"] += 1
        elif "RATE_LIMIT" in t_type or "BLOCKED" in t_type:
            breakdown["blocked_requests"] += 1
        elif "LOGIN" in t_type:
            breakdown["logins"] += 1

        ev_time = ev.created_at
        if ev_time.tzinfo is None:
            ev_time = ev_time.replace(tzinfo=timezone.utc)
        diff_secs = (ev_time - window_start).total_seconds()
        if diff_secs >= 0:
            idx = min(bucket_count - 1, int(diff_secs // (5 * 60)))
            points[idx] += 1

    total_events = db.query(Event).count()

    return {
        "points": points,
        "labels": labels,
        "total_events": total_events,
        "breakdown": breakdown,
    }
