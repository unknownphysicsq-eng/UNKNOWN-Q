import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.redis_client import redis_client

router = APIRouter(tags=["Health & Diagnostics"])


@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    """
    Health check endpoint verifying:
    - PostgreSQL database connectivity & latency
    - Redis connectivity & latency
    - Overall backend status
    """
    start_time = time.perf_counter()

    # 1. Check PostgreSQL
    db_status = "healthy"
    db_error = None
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = "unhealthy"
        db_error = str(e)

    # 2. Check Redis
    redis_status = "healthy"
    redis_error = None
    try:
        redis_client.ping()
    except Exception as e:
        redis_status = "unhealthy"
        redis_error = str(e)

    latency_ms = round((time.perf_counter() - start_time) * 1000, 2)
    overall_status = "healthy" if (db_status == "healthy" and redis_status == "healthy") else "degraded"

    return {
        "status": overall_status,
        "app_name": settings.APP_NAME,
        "environment": settings.ENVIRONMENT,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "latency_ms": latency_ms,
        "services": {
            "database": {
                "engine": "PostgreSQL",
                "status": db_status,
                "error": db_error,
            },
            "redis": {
                "status": redis_status,
                "error": redis_error,
            },
        },
    }
