from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, func
from sqlalchemy.orm import relationship
from app.database import Base


class Service(Base):
    """
    SQLAlchemy model representing an Academic Service/Form Offering.
    Examples: Exam Registration, Scholarship Application, Course Enrollment.
    """
    __tablename__ = "services"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    code = Column(String(64), unique=True, index=True, nullable=False)  # e.g. 'exam', 'scholarship', 'course'
    name = Column(String(255), nullable=False)                          # e.g. 'Exam Registration'
    icon = Column(String(32), nullable=True, default="📝")              # Emoji or icon identifier
    description = Column(Text, nullable=True)
    status = Column(String(64), default="Open Now", nullable=False)     # 'Open Now', 'Limited Slots', etc.
    deadline = Column(String(64), nullable=True)                       # e.g. 'Oct 30'
    academic_year = Column(String(32), default="2026–27", nullable=True)
    capacity = Column(Integer, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    applications = relationship(
        "Application",
        back_populates="service",
    )
    events = relationship(
        "Event",
        back_populates="service",
    )

    def __repr__(self) -> str:
        return f"<Service id={self.id} code='{self.code}' name='{self.name}'>"
