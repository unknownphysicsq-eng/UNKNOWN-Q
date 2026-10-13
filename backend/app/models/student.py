from sqlalchemy import Boolean, Column, DateTime, String, func
from sqlalchemy.orm import relationship
from app.database import Base


class Student(Base):
    """
    SQLAlchemy model representing a registered Student or Admin in FairForm AI.
    Contains hashed credentials, assigned role, and academic profile data.
    """
    __tablename__ = "students"

    id = Column(String(64), primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=True)
    course = Column(String(255), nullable=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(32), default="student", nullable=False)  # "student" | "admin"
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
        back_populates="student",
        cascade="all, delete-orphan",
    )
    events = relationship(
        "Event",
        back_populates="student",
    )

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    def __repr__(self) -> str:
        return f"<Student id={self.id} name='{self.name}' role='{self.role}'>"
