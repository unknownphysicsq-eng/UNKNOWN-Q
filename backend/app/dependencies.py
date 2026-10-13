from typing import Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.models.student import Student
from app.redis_client import redis_client
from app.security import decode_access_token

# Bearer token extractor
security_bearer = HTTPBearer(auto_error=False)


def check_login_rate_limit(student_id: str, client_ip: str = "127.0.0.1") -> None:
    """
    Validates that login attempts for this student ID or client IP
    have not exceeded the configured rate limit (e.g. 5 attempts in 60s).
    Raises HTTP 429 Too Many Requests if exceeded.
    """
    try:
        # Check by student ID
        id_key = f"ratelimit:login:id:{student_id}"
        attempts_id = int(redis_client.get(id_key) or 0)

        # Check by IP
        ip_key = f"ratelimit:login:ip:{client_ip}"
        attempts_ip = int(redis_client.get(ip_key) or 0)

        max_allowed = settings.LOGIN_RATE_LIMIT_MAX_ATTEMPTS
        if attempts_id >= max_allowed or attempts_ip >= (max_allowed * 2):
            ttl_id = redis_client.ttl(id_key)
            ttl_remaining = max(1, ttl_id if ttl_id > 0 else settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed login attempts. Please wait {ttl_remaining} seconds before trying again.",
                headers={"Retry-After": str(ttl_remaining)},
            )
    except HTTPException:
        raise
    except Exception:
        # Graceful fallback if Redis is temporarily unreachable
        pass


def record_failed_login(student_id: str, client_ip: str = "127.0.0.1") -> None:
    """
    Increments the failed login attempt counter in Redis with TTL expiration.
    """
    try:
        window = settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS
        id_key = f"ratelimit:login:id:{student_id}"
        ip_key = f"ratelimit:login:ip:{client_ip}"

        pipe = redis_client.pipeline()
        pipe.incr(id_key)
        pipe.expire(id_key, window)
        pipe.incr(ip_key)
        pipe.expire(ip_key, window)
        pipe.execute()
    except Exception:
        pass


def clear_login_rate_limit(student_id: str, client_ip: str = "127.0.0.1") -> None:
    """
    Clears failed login attempt counters upon successful authentication.
    """
    try:
        id_key = f"ratelimit:login:id:{student_id}"
        redis_client.delete(id_key)
    except Exception:
        pass


def get_current_student(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    db: Session = Depends(get_db),
) -> Student:
    """
    FastAPI dependency to verify JWT access token and return the student record from PostgreSQL.
    Protects student endpoints against unauthenticated access.
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    try:
        payload = decode_access_token(token)
        student_id: str = payload.get("sub")
        if not student_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token payload missing student subject",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Fetch fresh student record from PostgreSQL
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Student account no longer exists in database",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not student.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student account has been deactivated",
        )

    return student


def require_admin(
    current_student: Student = Depends(get_current_student),
) -> Student:
    """
    FastAPI dependency ensuring the authenticated user has the 'admin' role.
    Protects admin-only dashboard and management endpoints.
    """
    if current_student.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required to access this resource",
        )
    return current_student
