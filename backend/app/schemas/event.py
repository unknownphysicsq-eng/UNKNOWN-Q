from datetime import datetime
from typing import Any, Dict, Optional
from pydantic import BaseModel, ConfigDict


class EventBase(BaseModel):
    event_type: str
    student_id: Optional[str] = None
    service_id: Optional[int] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None


class EventCreate(EventBase):
    pass


class EventRead(EventBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
