from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class QueueJoinRequest(BaseModel):
    student_id: str = Field(..., description="Student ID joining the queue")
    service_code: str = Field("exam", description="Academic service code (e.g. exam, scholarship, course)")

    model_config = ConfigDict(populate_by_name=True)


class QueueStatusResponse(BaseModel):
    student_id: str
    service_code: str
    status: str  # "waiting" | "admitted" | "not_in_queue"
    queue_position: int = Field(..., description="1-indexed position in queue (1 means front of queue)")
    students_ahead: int = Field(..., description="Number of students waiting ahead")
    total_in_queue: int = Field(..., description="Total students currently waiting in this service queue")
    estimated_wait_seconds: int = Field(..., description="Estimated wait time in seconds")
    admission_token: Optional[str] = Field(None, description="Cryptographic admission pass issued when admitted")
    token_expires_in: Optional[int] = Field(None, description="Seconds remaining before admission token expires")

    model_config = ConfigDict(from_attributes=True)


class QueueLeaveResponse(BaseModel):
    success: bool
    student_id: str
    service_code: str
    message: str
