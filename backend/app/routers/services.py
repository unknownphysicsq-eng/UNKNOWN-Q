from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.service import Service
from app.schemas.service import ServiceRead, ServiceCreate

router = APIRouter(prefix="/services", tags=["Services Catalog"])

DEFAULT_SERVICES = [
    {
        "code": "exam",
        "name": "Exam Registration",
        "icon": "📝",
        "description": "Register for your upcoming semester examinations.",
        "status": "Open Now",
        "deadline": "Oct 30",
        "academic_year": "2026–27",
        "capacity": 500,
    },
    {
        "code": "scholarship",
        "name": "Scholarship Application",
        "icon": "🎓",
        "description": "Apply for merit-based financial aid and scholarships.",
        "status": "Limited Slots",
        "deadline": "Nov 12",
        "academic_year": "2026–27",
        "capacity": 150,
    },
    {
        "code": "course",
        "name": "Course Enrollment",
        "icon": "📚",
        "description": "Choose electives and enroll in next semester courses.",
        "status": "Enrollment Open",
        "deadline": "Nov 20",
        "academic_year": "2026–27",
        "capacity": 300,
    },
]


@router.get("", response_model=List[ServiceRead])
def list_services(db: Session = Depends(get_db)):
    """
    List all active academic services in the PostgreSQL database.
    If database was just initialized, auto-seeds default catalog items.
    """
    services = db.query(Service).filter(Service.is_active == True).all()

    if not services:
        for s_data in DEFAULT_SERVICES:
            s_obj = Service(**s_data)
            db.add(s_obj)
        db.commit()
        services = db.query(Service).filter(Service.is_active == True).all()

    return services


@router.get("/{service_code}", response_model=ServiceRead)
def get_service_by_code(service_code: str, db: Session = Depends(get_db)):
    """Retrieve details for a specific service by its code."""
    service = db.query(Service).filter(Service.code == service_code).first()
    if not service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Service '{service_code}' not found",
        )
    return service
