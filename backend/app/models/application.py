from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, JSON, func
from sqlalchemy.orm import relationship
from app.database import Base


class Application(Base):
    """
    SQLAlchemy model representing a Student's submitted application.
    Stores the unique reference token, status, and dynamic JSON form payload.
    """
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    reference = Column(String(64), unique=True, index=True, nullable=False)  # e.g. "FF-K89X2026"

    # Foreign Keys
    student_id = Column(
        String(64),
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    service_id = Column(
        Integer,
        ForeignKey("services.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    status = Column(String(64), default="submitted", nullable=False)  # submitted, under_review, approved, rejected
    details = Column(JSON, nullable=False, default=dict)               # form payload key-values
    submission_date = Column(String(64), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    student = relationship("Student", back_populates="applications")
    service = relationship("Service", back_populates="applications")

    def __repr__(self) -> str:
        return f"<Application id={self.id} ref='{self.reference}' student_id='{self.student_id}'>"
