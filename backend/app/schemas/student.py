from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class StudentBase(BaseModel):
    name: str
    email: Optional[str] = None
    course: Optional[str] = None
    role: Optional[str] = "student"


class StudentCreate(StudentBase):
    id: str
    password: str = Field(..., min_length=6, description="Plain text password to be hashed")


class StudentUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    course: Optional[str] = None
    is_active: Optional[bool] = None


class StudentProfileUpdate(BaseModel):
    """
    Schema for student self-service profile updates.
    Strictly forbids modifying student ID, password hash, role, or active status.
    """
    name: Optional[str] = Field(None, min_length=1, max_length=100, description="Full Student Name")
    course: Optional[str] = Field(None, max_length=120, description="Enrolled Course or Department")
    email: Optional[str] = Field(None, max_length=120, description="Student Email Address")

    model_config = ConfigDict(extra="forbid")


class StudentRead(StudentBase):
    id: str
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    student_id: str = Field(..., description="Student ID or Admin ID")
    password: str = Field(..., description="Student password")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: StudentRead
