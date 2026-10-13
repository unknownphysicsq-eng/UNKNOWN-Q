import redis
from app.config import settings

# Initialize Redis connection pool
redis_pool = redis.ConnectionPool.from_url(
    settings.get_redis_url(),
    decode_responses=True,
    socket_timeout=3.0,
    socket_connect_timeout=3.0,
)

redis_client = redis.Redis(connection_pool=redis_pool)


def get_redis() -> redis.Redis:
    """
    FastAPI dependency yielding a thread-safe Redis client instance.
    """
    return redis_client


def check_redis_health() -> bool:
    """
    Verify Redis connectivity by sending a PING command.
    """
    try:
        return bool(redis_client.ping())
    except Exception:
        return False
