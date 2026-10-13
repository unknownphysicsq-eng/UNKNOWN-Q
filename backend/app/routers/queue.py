from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.event import Event
from app.schemas.queue import (
    QueueJoinRequest,
    QueueStatusResponse,
    QueueLeaveResponse,
)
from app.services.queue_manager import queue_manager

router = APIRouter(tags=["Virtual Waiting Room"])


@router.post(
    "/queue/join",
    response_model=QueueStatusResponse,
    summary="Join virtual waiting room queue",
    status_code=status.HTTP_200_OK,
)
def join_queue(
    payload: QueueJoinRequest,
    response: Response,
    capacity: int = Query(2, description="Configurable concurrent admission capacity", ge=1),
    db: Session = Depends(get_db),
):
    """
    Join the FIFO virtual waiting room for an academic service.
    - Preserves arrival order using Redis Sorted Sets (ZSET)
    - Enforces max 5 joins per student per 60 seconds
    - Returns HTTP 429 with 'Retry-After' header if exceeded
    - Prevents duplicates (preserves original queue rank if already waiting)
    - Automatically admits student when within capacity, issuing a short-lived token
    - Records audit events (QUEUE_JOIN, QUEUE_ADMISSION, RATE_LIMIT_REJECTION) in PostgreSQL
    """
    student_id = payload.student_id.strip()
    service_code = payload.service_code.strip()

    # 1. Server-side Redis Rate Limiting (5 joins per student per 60 seconds)
    retry_after = queue_manager.check_join_rate_limit(student_id)
    if retry_after is not None:
        try:
            event = Event(
                event_type="RATE_LIMIT_REJECTION",
                student_id=student_id,
                payload={"service": service_code, "action": "queue_join", "retry_after": retry_after},
            )
            db.add(event)
            db.commit()
        except Exception:
            db.rollback()

        response.headers["Retry-After"] = str(retry_after)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many queue join requests. Limit is 5 per 60 seconds. Please retry in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )

    # 2. Add to Redis Sorted Set and calculate position
    result = queue_manager.join_queue(
        student_id=student_id,
        service_code=service_code,
        capacity=capacity,
    )

    # 3. Record Telemetry Events in PostgreSQL
    try:
        join_event = Event(
            event_type="QUEUE_JOIN",
            student_id=student_id,
            payload={"service": service_code, "position": result.queue_position, "status": result.status},
        )
        db.add(join_event)

        if result.status == "admitted" and result.admission_token:
            admit_event = Event(
                event_type="QUEUE_ADMISSION",
                student_id=student_id,
                payload={"service": service_code, "token": result.admission_token},
            )
            db.add(admit_event)

        db.commit()
    except Exception:
        db.rollback()

    return result


@router.get(
    "/queue/status",
    response_model=QueueStatusResponse,
    summary="Get current queue position and admission status",
)
def get_queue_status(
    student_id: str = Query(..., description="Student ID to query"),
    service_code: str = Query("exam", description="Academic service code (e.g. exam, scholarship, course)"),
    capacity: int = Query(2, description="Configurable concurrent admission capacity", ge=1),
):
    """
    Poll the current queue position, number of students ahead, and admission status.
    - Refreshes student's heartbeat to prevent abandonment cleanup
    - Automatically detects if the student has reached admission capacity
    - Returns short-lived admission token when admitted
    """
    clean_id = student_id.strip()
    clean_service = service_code.strip()

    result = queue_manager.get_status(
        student_id=clean_id,
        service_code=clean_service,
        capacity=capacity,
    )

    if result.status == "not_in_queue":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student '{clean_id}' is not in the queue for service '{clean_service}'.",
        )

    return result


@router.delete(
    "/queue/leave",
    response_model=QueueLeaveResponse,
    summary="Leave the virtual waiting room queue",
)
def leave_queue(
    student_id: str = Query(..., description="Student ID to remove from queue"),
    service_code: str = Query("exam", description="Academic service code"),
):
    """
    Removes student from the Redis Sorted Set queue and revokes any issued admission token.
    """
    clean_id = student_id.strip()
    clean_service = service_code.strip()

    removed = queue_manager.leave_queue(
        student_id=clean_id,
        service_code=clean_service,
    )

    return QueueLeaveResponse(
        success=removed,
        student_id=clean_id,
        service_code=clean_service,
        message="Successfully removed from queue." if removed else "Student was not in queue.",
    )
