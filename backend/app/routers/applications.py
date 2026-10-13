import time
import uuid
from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_student
from app.models.student import Student
from app.models.service import Service
from app.models.application import Application
from app.models.event import Event
from app.schemas.application import (
    ApplicationSubmissionRequest,
    ApplicationResponse,
    ExamFormDetails,
    ScholarshipFormDetails,
    CourseFormDetails,
)
from app.services.queue_manager import queue_manager

router = APIRouter(tags=["Academic Applications"])


def validate_service_details(service_code: str, raw_details: dict) -> dict:
    """
    Validates form payload fields against service-specific Pydantic schemas.
    """
    code = service_code.lower()
    try:
        if code == "exam":
            validated = ExamFormDetails.model_validate(raw_details)
            return validated.model_dump()
        elif code == "scholarship":
            validated = ScholarshipFormDetails.model_validate(raw_details)
            return validated.model_dump()
        elif code == "course":
            validated = CourseFormDetails.model_validate(raw_details)
            return validated.model_dump()
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported service code '{service_code}'",
            )
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Form validation error: {str(ve)}",
        )


def generate_reference_number(service_code: str) -> str:
    """
    Generates a unique, server-authoritative application reference code.
    Format: FF-<SERVICE_UPPER>-<TIMESTAMP_HEX>-<RANDOM_CHARS>
    """
    ts_part = hex(int(time.time()))[2:].upper()
    random_part = uuid.uuid4().hex[:6].upper()
    return f"FF-{service_code.upper()}-{ts_part}-{random_part}"


@router.post(
    "/applications",
    response_model=ApplicationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit academic application with admission pass token",
)
def submit_application(
    payload: ApplicationSubmissionRequest,
    current_student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Submit an academic application for Exam Registration, Scholarship, or Course Enrollment.
    - Requires authenticated student JWT
    - Validates server-issued admission pass token from Redis
    - Protects against duplicate requests caused by double-clicking or retries
    - Validates all service-specific fields server-side
    - Enforces one-application-per-service duplicate prevention
    - Stores submission in PostgreSQL using JSONB for form fields
    - Consumes the admission token ONLY after database commit
    """
    service_code = payload.service_code.strip().lower()

    # 1. Acquire double-click / retry concurrency lock in Redis
    if not queue_manager.acquire_submission_lock(current_student.id, service_code):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A submission for this service is currently being processed. Please do not double-click.",
        )

    try:
        # 2. Look up Service from PostgreSQL
        service = db.query(Service).filter(Service.code == service_code).first()
        if not service:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Service '{service_code}' not found in catalog.",
            )

        if not service.is_active or service.status == "Closed":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"The application window for {service.name} is currently closed.",
            )

        # 3. Verify server-issued admission token
        is_valid, reason = queue_manager.validate_admission_token(
            token=payload.admission_token.strip(),
            student_id=current_student.id,
            service_code=service_code,
        )
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Admission verification failed: {reason}",
            )

        # 4. Strict Server-Side Field Validation
        student_id_in_details = payload.details.get("studentId") or payload.details.get("student_id")
        if student_id_in_details and str(student_id_in_details).strip() != current_student.id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Student ID in application details must match authenticated student ({current_student.id}).",
            )

        declaration = payload.details.get("declaration")
        if not declaration or declaration == "false" or declaration is False:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Declaration confirmation must be accepted.",
            )

        cleaned_details = validate_service_details(service_code, payload.details)

        # 5. Duplicate Submission Rule Check
        existing_app = (
            db.query(Application)
            .filter(
                Application.student_id == current_student.id,
                Application.service_id == service.id,
            )
            .first()
        )
        if existing_app:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"You have already submitted an application for {service.name} "
                    f"(Reference: {existing_app.reference}). Duplicate submissions are not permitted."
                ),
            )

        # 6. Generate Unique Server Reference Number
        reference = generate_reference_number(service_code)
        now_str = datetime.now(timezone.utc).strftime("%m/%d/%Y, %I:%M:%S %p UTC")

        # 7. Persist to PostgreSQL Database
        application_record = Application(
            reference=reference,
            student_id=current_student.id,
            service_id=service.id,
            status="submitted",
            details=cleaned_details,
            submission_date=now_str,
        )
        db.add(application_record)

        # Telemetry audit log
        event = Event(
            event_type="APPLICATION_SUBMITTED",
            student_id=current_student.id,
            service_id=service.id,
            payload={"reference": reference, "service": service.name},
        )
        db.add(event)

        db.commit()
        db.refresh(application_record)

        # 8. Token Consumption: Consume admission token in Redis ONLY after DB commit
        queue_manager.consume_admission_token(current_student.id, service_code)

        return ApplicationResponse(
            id=application_record.id,
            reference=application_record.reference,
            student_id=application_record.student_id,
            service_code=service.code,
            service_name=service.name,
            status=application_record.status,
            details=application_record.details,
            submission_date=application_record.submission_date,
            created_at=application_record.created_at,
        )

    finally:
        # Always release the submission lock
        queue_manager.release_submission_lock(current_student.id, service_code)


@router.get(
    "/applications",
    response_model=List[ApplicationResponse],
    summary="List applications for authenticated student or all applications for admin",
)
def list_applications(
    student_id: Optional[str] = Query(None, description="Filter by student ID (Admin only)"),
    current_student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Retrieve application submission records from PostgreSQL.
    - Regular students can only retrieve their own submissions.
    - Administrators can inspect all records or filter by student ID.
    """
    query = db.query(Application).join(Service, Application.service_id == Service.id)

    if current_student.role == "admin":
        if student_id:
            query = query.filter(Application.student_id == student_id.strip())
    else:
        query = query.filter(Application.student_id == current_student.id)

    applications = query.order_by(Application.created_at.desc()).all()

    results = []
    for app in applications:
        results.append(
            ApplicationResponse(
                id=app.id,
                reference=app.reference,
                student_id=app.student_id,
                service_code=app.service.code,
                service_name=app.service.name,
                status=app.status,
                details=app.details,
                submission_date=app.submission_date or app.created_at.isoformat(),
                created_at=app.created_at,
            )
        )
    return results
