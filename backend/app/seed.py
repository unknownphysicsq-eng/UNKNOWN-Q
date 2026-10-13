import sys
from sqlalchemy.orm import Session
from app.database import SessionLocal, init_db
from app.models.student import Student
from app.models.service import Service
from app.security import hash_password

INITIAL_STUDENTS = [
    {
        "id": "STU-2026-001",
        "name": "Alex Morgan",
        "email": "alex.morgan@fairform.edu",
        "course": "Computer Science and Engineering (CSE)",
        "password": "Password@123",
        "role": "student",
    },
    {
        "id": "STU-2026-002",
        "name": "Priya Sharma",
        "email": "priya.sharma@fairform.edu",
        "course": "Artificial Intelligence and Data Science (AI & DS)",
        "password": "Password@123",
        "role": "student",
    },
    {
        "id": "ADMIN-001",
        "name": "Administrator Dean",
        "email": "dean.admin@fairform.edu",
        "course": "Academic Administration",
        "password": "Admin@Secure2026",
        "role": "admin",
    },
]

INITIAL_SERVICES = [
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


def seed_database(db: Session = None) -> None:
    """
    Seeds initial students, admin user, and academic services catalog
    into PostgreSQL if they do not already exist.
    """
    close_db = False
    if db is None:
        init_db()
        db = SessionLocal()
        close_db = True

    try:
        # 1. Seed Students & Admin
        for s_data in INITIAL_STUDENTS:
            existing = db.query(Student).filter(Student.id == s_data["id"]).first()
            if not existing:
                student = Student(
                    id=s_data["id"],
                    name=s_data["name"],
                    email=s_data["email"],
                    course=s_data["course"],
                    role=s_data["role"],
                    password_hash=hash_password(s_data["password"]),
                    is_active=True,
                )
                db.add(student)
                print(f"[Seed] Created {s_data['role']} account: {s_data['id']} ({s_data['name']})")
            else:
                # Update password hash if needed
                existing.password_hash = hash_password(s_data["password"])
                existing.name = s_data["name"]
                existing.course = s_data["course"]
                existing.role = s_data["role"]
                print(f"[Seed] Verified account: {s_data['id']}")

        # 2. Seed Services
        for svc_data in INITIAL_SERVICES:
            existing_svc = db.query(Service).filter(Service.code == svc_data["code"]).first()
            if not existing_svc:
                svc = Service(**svc_data)
                db.add(svc)
                print(f"[Seed] Created service: {svc_data['code']}")

        db.commit()
        print("[Seed] Seeding completed successfully.")
    except Exception as exc:
        db.rollback()
        print(f"[Seed] Error during seeding: {exc}", file=sys.stderr)
        raise
    finally:
        if close_db:
            db.close()


if __name__ == "__main__":
    seed_database()
