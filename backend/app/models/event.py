from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, JSON, func
from sqlalchemy.orm import relationship
from app.database import Base


class Event(Base):
    """
    SQLAlchemy model representing telemetry and audit events.
    Captures traffic spikes, queue activity, rate limiting, and submission attempts.
    """
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    event_type = Column(String(100), nullable=False, index=True)  # e.g., 'TRAFFIC_HIT', 'RATE_LIMITED'

    # Optional references
    student_id = Column(
        String(64),
        ForeignKey("students.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    service_id = Column(
        Integer,
        ForeignKey("services.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)
    payload = Column(JSON, nullable=True, default=dict)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    # Relationships
    student = relationship("Student", back_populates="events")
    service = relationship("Service", back_populates="events")

    def __repr__(self) -> str:
        return f"<Event id={self.id} type='{self.event_type}'>"
