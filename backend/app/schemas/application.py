from datetime import datetime
from typing import Any, Dict, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


class ExamFormDetails(BaseModel):
    fullName: str = Field(..., min_length=2)
    studentId: str = Field(..., min_length=2)
    department: str = Field(..., min_length=2)
    examType: str = Field(..., min_length=2)
    examSemester: Optional[str] = None
    semester: Optional[str] = None
    subjectCodes: Optional[str] = None
    subjectNames: Optional[str] = None
    examMode: Optional[str] = None
    examCentre: Optional[str] = None

    model_config = ConfigDict(extra="allow")

    @model_validator(mode="after")
    def validate_exam(self):
        sem = self.examSemester or self.semester
        if not sem:
            raise ValueError("Examination semester is required")
        return self


class ScholarshipFormDetails(BaseModel):
    fullName: str = Field(..., min_length=2)
    studentId: str = Field(..., min_length=2)
    department: str = Field(..., min_length=2)
    category: Optional[str] = None
    scheme: Optional[str] = None
    cgpa: Optional[Any] = None
    gpa: Optional[Any] = None
    income: Optional[Any] = None
    householdIncome: Optional[Any] = None

    model_config = ConfigDict(extra="allow")

    @model_validator(mode="after")
    def validate_scholarship(self):
        cat = self.category or self.scheme
        if not cat:
            raise ValueError("Scholarship category/scheme is required")
        score = self.cgpa if self.cgpa is not None else self.gpa
        if score is None:
            raise ValueError("CGPA / GPA is required")
        try:
            val = float(score)
            if val < 0.0 or val > 10.0:
                raise ValueError("GPA must be between 0.0 and 10.0")
        except (TypeError, ValueError):
            raise ValueError("CGPA must be a valid number between 0.0 and 10.0")
        inc = self.income if self.income is not None else self.householdIncome
        if inc is None or str(inc).strip() == "":
            raise ValueError("Family / Household Income is required")
        return self


class CourseFormDetails(BaseModel):
    fullName: str = Field(..., min_length=2)
    studentId: str = Field(..., min_length=2)
    department: str = Field(..., min_length=2)
    credits: Optional[str] = None
    preferredSemester: Optional[str] = None
    batch: Optional[str] = None
    primaryElective: Optional[str] = None
    openElective: Optional[str] = None

    model_config = ConfigDict(extra="allow")

    @model_validator(mode="after")
    def validate_course(self):
        if not self.credits and not self.primaryElective:
            raise ValueError("Course selection credits or elective choice is required")
        return self


class ApplicationSubmissionRequest(BaseModel):
    service_code: str = Field(..., alias="serviceKey", description="Service code: exam, scholarship, or course")
    admission_token: str = Field(..., alias="admissionToken", description="Valid server-issued admission pass token")
    details: Dict[str, Any] = Field(..., description="Service-specific form payload")

    model_config = ConfigDict(populate_by_name=True)


class ApplicationResponse(BaseModel):
    id: int
    reference: str
    student_id: str
    service_code: str
    service_name: str
    status: str
    details: Dict[str, Any]
    submission_date: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
