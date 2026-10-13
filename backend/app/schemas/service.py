from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class ServiceBase(BaseModel):
    code: str
    name: str
    icon: Optional[str] = "📝"
    description: Optional[str] = None
    status: Optional[str] = "Open Now"
    deadline: Optional[str] = None
    academic_year: Optional[str] = "2026–27"
    capacity: Optional[int] = None
    is_active: Optional[bool] = True


class ServiceCreate(ServiceBase):
    pass


class ServiceUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    deadline: Optional[str] = None
    academic_year: Optional[str] = None
    capacity: Optional[int] = None
    is_active: Optional[bool] = None


class ServiceRead(ServiceBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
