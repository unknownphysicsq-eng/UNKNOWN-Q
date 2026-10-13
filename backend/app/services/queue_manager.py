import hashlib
import hmac
import time
from typing import Optional, Tuple
import redis
from app.config import settings
from app.redis_client import redis_client
from app.schemas.queue import QueueStatusResponse

# Constants
DEFAULT_SERVICE_CAPACITY = 2          # Max concurrent admitted students per service
ADMISSION_TOKEN_TTL_SECONDS = 600     # 10 minutes valid admission window
HEARTBEAT_TTL_SECONDS = 90            # Abandonment threshold (no poll for 90s removes user)
AVG_SERVICE_SECONDS_PER_STUDENT = 30  # Estimated processing time per student ahead
JOIN_RATE_LIMIT_MAX = 5               # Max 5 joins per 60 seconds
JOIN_RATE_LIMIT_WINDOW = 60           # 60 seconds window


class QueueManager:
    """
    Manages Redis Sorted Sets (ZSET) for multi-service virtual waiting rooms.
    Ensures FIFO arrival ordering, prevents duplicates, enforces admission capacity,
    issues tamper-proof admission tokens, removes abandoned sessions, and rate-limits joins.
    """

    def __init__(self, client: redis.Redis = redis_client):
        self.r = client

    def _queue_key(self, service_code: str) -> str:
        return f"queue:zset:{service_code.lower()}"

    def _token_key(self, service_code: str, student_id: str) -> str:
        return f"admission:token:{service_code.lower()}:{student_id}"

    def _heartbeat_key(self, service_code: str, student_id: str) -> str:
        return f"queue:heartbeat:{service_code.lower()}:{student_id}"

    def _join_ratelimit_key(self, student_id: str) -> str:
        return f"ratelimit:queue_join:{student_id}"

    def generate_admission_token(self, student_id: str, service_code: str) -> str:
        """
        Generates a secure, short-lived admission pass token signed with HMAC-SHA256.
        """
        timestamp = int(time.time())
        raw_msg = f"{student_id}:{service_code}:{timestamp}"
        signature = hmac.new(
            settings.JWT_SECRET_KEY.encode("utf-8"),
            raw_msg.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()[:16].upper()
        return f"PASS-{service_code.upper()}-{student_id}-{timestamp}-{signature}"

    def check_join_rate_limit(self, student_id: str) -> Optional[int]:
        """
        Enforces 5 joins per student per 60 seconds.
        Returns remaining retry-after seconds if rate limit exceeded, or None if allowed.
        """
        try:
            now = time.time()
            cutoff = now - JOIN_RATE_LIMIT_WINDOW
            key = self._join_ratelimit_key(student_id)

            # Store timestamps in a Redis sorted set for exact sliding window
            pipe = self.r.pipeline()
            pipe.zremrangebyscore(key, "-inf", cutoff)
            pipe.zcard(key)
            results = pipe.execute()
            count = results[1]

            if count >= JOIN_RATE_LIMIT_MAX:
                # Get the oldest timestamp in window to calculate exact retry-after
                oldest_entries = self.r.zrange(key, 0, 0, withscores=True)
                if oldest_entries:
                    oldest_ts = oldest_entries[0][1]
                    retry_after = max(1, int(oldest_ts + JOIN_RATE_LIMIT_WINDOW - now))
                else:
                    retry_after = JOIN_RATE_LIMIT_WINDOW
                return retry_after

            # Record this join attempt
            pipe = self.r.pipeline()
            pipe.zadd(key, {str(now): now})
            pipe.expire(key, JOIN_RATE_LIMIT_WINDOW)
            pipe.execute()
            return None
        except Exception:
            return None

    def refresh_heartbeat(self, service_code: str, student_id: str) -> None:
        """
        Sets or refreshes the student's queue heartbeat key with TTL.
        """
        try:
            hb_key = self._heartbeat_key(service_code, student_id)
            self.r.set(hb_key, "active", ex=HEARTBEAT_TTL_SECONDS)
        except Exception:
            pass

    def cleanup_abandoned_entries(self, service_code: str) -> int:
        """
        Prunes waiting students whose heartbeat expired (inactive for > 90s).
        Returns the number of removed abandoned students.
        """
        try:
            queue_key = self._queue_key(service_code)
            all_students = self.r.zrange(queue_key, 0, -1)
            if not all_students:
                return 0

            abandoned = []
            for stu_id in all_students:
                hb_key = self._heartbeat_key(service_code, stu_id)
                # If heartbeat expired and no active admission token, mark abandoned
                if not self.r.exists(hb_key):
                    token_key = self._token_key(service_code, stu_id)
                    if not self.r.exists(token_key):
                        abandoned.append(stu_id)

            if abandoned:
                self.r.zrem(queue_key, *abandoned)
                return len(abandoned)
            return 0
        except Exception:
            return 0

    def join_queue(
        self,
        student_id: str,
        service_code: str,
        capacity: int = DEFAULT_SERVICE_CAPACITY,
    ) -> QueueStatusResponse:
        """
        Adds a student to the academic service's Redis Sorted Set.
        - Preserves FIFO arrival order using millisecond score.
        - Prevents duplicate entries (if already in queue, preserves original position).
        - Automatically evaluates admission capacity.
        """
        service_code = service_code.lower()
        queue_key = self._queue_key(service_code)

        # 1. Clean up stale entries
        self.cleanup_abandoned_entries(service_code)

        # 2. Check if student already in queue
        existing_score = self.r.zscore(queue_key, student_id)
        if existing_score is None:
            # First arrival: add with current millisecond timestamp
            now_ms = time.time() * 1000
            self.r.zadd(queue_key, {student_id: now_ms})

        # 3. Refresh heartbeat
        self.refresh_heartbeat(service_code, student_id)

        # 4. Compute status and position
        return self.get_status(student_id, service_code, capacity)

    def get_status(
        self,
        student_id: str,
        service_code: str,
        capacity: int = DEFAULT_SERVICE_CAPACITY,
    ) -> QueueStatusResponse:
        """
        Inspects the student's exact rank in the Redis Sorted Set (via ZRANK).
        - Checks admission eligibility against capacity.
        - Issues or returns short-lived admission token when admitted.
        """
        service_code = service_code.lower()
        queue_key = self._queue_key(service_code)
        token_key = self._token_key(service_code, student_id)

        # Refresh heartbeat on status check
        self.refresh_heartbeat(service_code, student_id)

        # Check existing admission token
        existing_token = self.r.get(token_key)
        if existing_token:
            ttl = max(0, self.r.ttl(token_key))
            total = self.r.zcard(queue_key) or 1
            return QueueStatusResponse(
                student_id=student_id,
                service_code=service_code,
                status="admitted",
                queue_position=1,
                students_ahead=0,
                total_in_queue=total,
                estimated_wait_seconds=0,
                admission_token=existing_token,
                token_expires_in=ttl,
            )

        # Get rank from Redis Sorted Set (0-indexed)
        rank = self.r.zrank(queue_key, student_id)
        total = self.r.zcard(queue_key) or 0

        if rank is None:
            return QueueStatusResponse(
                student_id=student_id,
                service_code=service_code,
                status="not_in_queue",
                queue_position=0,
                students_ahead=0,
                total_in_queue=total,
                estimated_wait_seconds=0,
                admission_token=None,
                token_expires_in=None,
            )

        # If student's rank is within admission capacity, admit them!
        if rank < capacity:
            admission_token = self.generate_admission_token(student_id, service_code)
            self.r.set(token_key, admission_token, ex=ADMISSION_TOKEN_TTL_SECONDS)

            return QueueStatusResponse(
                student_id=student_id,
                service_code=service_code,
                status="admitted",
                queue_position=1,
                students_ahead=0,
                total_in_queue=total,
                estimated_wait_seconds=0,
                admission_token=admission_token,
                token_expires_in=ADMISSION_TOKEN_TTL_SECONDS,
            )

        # Student is waiting in queue
        students_ahead = rank
        queue_position = rank + 1
        wait_seconds = (rank - capacity + 1) * AVG_SERVICE_SECONDS_PER_STUDENT

        return QueueStatusResponse(
            student_id=student_id,
            service_code=service_code,
            status="waiting",
            queue_position=queue_position,
            students_ahead=students_ahead,
            total_in_queue=total,
            estimated_wait_seconds=wait_seconds,
            admission_token=None,
            token_expires_in=None,
        )

    def leave_queue(self, student_id: str, service_code: str) -> bool:
        """
        Removes student from Redis Sorted Set and revokes active tokens & heartbeats.
        """
        service_code = service_code.lower()
        queue_key = self._queue_key(service_code)
        token_key = self._token_key(service_code, student_id)
        hb_key = self._heartbeat_key(service_code, student_id)

        pipe = self.r.pipeline()
        pipe.zrem(queue_key, student_id)
        pipe.delete(token_key)
        pipe.delete(hb_key)
        results = pipe.execute()

        return bool(results[0] > 0 or results[1] > 0)

    def acquire_submission_lock(self, student_id: str, service_code: str) -> bool:
        """
        Acquires a short 10-second distributed lock to prevent duplicate submissions
        caused by double-clicking or simultaneous retries.
        """
        lock_key = f"lock:submit:{service_code.lower()}:{student_id}"
        return bool(self.r.set(lock_key, "locked", nx=True, ex=10))

    def release_submission_lock(self, student_id: str, service_code: str) -> None:
        """
        Releases the double-click submission lock.
        """
        try:
            lock_key = f"lock:submit:{service_code.lower()}:{student_id}"
            self.r.delete(lock_key)
        except Exception:
            pass

    def validate_admission_token(self, token: str, student_id: str, service_code: str) -> Tuple[bool, str]:
        """
        Validates that the admission token belongs to the student, matches the service,
        has not expired, and is actively registered in Redis.
        """
        if not token or not token.startswith(f"PASS-{service_code.upper()}-{student_id}-"):
            return False, "Admission token does not belong to this student or service."

        token_key = self._token_key(service_code, student_id)
        cached_token = self.r.get(token_key)
        if not cached_token:
            return False, "Admission token has expired or was already consumed. Please re-enter the queue."

        if cached_token != token:
            return False, "Invalid admission token."

        return True, "Valid"

    def consume_admission_token(self, student_id: str, service_code: str) -> None:
        """
        Atomically consumes the admission token and removes the student from the waiting queue
        upon successful application submission.
        """
        service_code = service_code.lower()
        token_key = self._token_key(service_code, student_id)
        queue_key = self._queue_key(service_code)
        hb_key = self._heartbeat_key(service_code, student_id)

        pipe = self.r.pipeline()
        pipe.delete(token_key)
        pipe.zrem(queue_key, student_id)
        pipe.delete(hb_key)
        pipe.execute()

    def get_total_waiting_count(self) -> int:
        """
        Calculates real-time count of students currently waiting in Redis Sorted Sets across services.
        """
        try:
            total = 0
            for code in ["exam", "scholarship", "course"]:
                total += self.r.zcard(self._queue_key(code))
            return total
        except Exception:
            return 0


queue_manager = QueueManager()
