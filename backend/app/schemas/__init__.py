from app.schemas.student import (
    StudentBase,
    StudentCreate,
    StudentRead,
    StudentUpdate,
    StudentProfileUpdate,
    LoginRequest,
    TokenResponse,
)
from app.schemas.service import ServiceBase, ServiceCreate, ServiceRead, ServiceUpdate
from app.schemas.application import (
    ExamFormDetails,
    ScholarshipFormDetails,
    CourseFormDetails,
    ApplicationSubmissionRequest,
    ApplicationResponse,
)
from app.schemas.event import EventBase, EventCreate, EventRead
from app.schemas.queue import QueueJoinRequest, QueueStatusResponse, QueueLeaveResponse

__all__ = [
    "StudentBase",
    "StudentCreate",
    "StudentRead",
    "StudentUpdate",
    "LoginRequest",
    "TokenResponse",
    "ServiceBase",
    "ServiceCreate",
    "ServiceRead",
    "ServiceUpdate",
    "ExamFormDetails",
    "ScholarshipFormDetails",
    "CourseFormDetails",
    "ApplicationSubmissionRequest",
    "ApplicationResponse",
    "EventBase",
    "EventCreate",
    "EventRead",
    "QueueJoinRequest",
    "QueueStatusResponse",
    "QueueLeaveResponse",
]
