# FairForm AI — FastAPI, PostgreSQL & Redis Backend

This directory contains the foundational backend service for **FairForm AI**, built with **Python FastAPI**, **PostgreSQL** (via SQLAlchemy ORM), and **Redis**.

---

## 📁 Project Architecture

```
backend/
├── app/
│   ├── __init__.py          # App package declaration
│   ├── config.py            # Pydantic Settings & environment variables
│   ├── database.py          # SQLAlchemy engine, session maker, init_db()
│   ├── redis_client.py      # Redis connection pool & health diagnostics
│   ├── main.py              # FastAPI application bootstrap & lifespan
│   ├── models/              # SQLAlchemy Database Models
│   │   ├── __init__.py      # Model exports
│   │   ├── student.py       # Student accounts & profiles
│   │   ├── service.py       # Academic services catalog (Exam, Scholarship, Course)
│   │   ├── application.py   # Submitted applications & reference records
│   │   └── event.py         # Telemetry & traffic audit log
│   ├── schemas/             # Pydantic validation schemas
│   │   ├── __init__.py
│   │   ├── student.py
│   │   ├── service.py
│   │   ├── application.py
│   │   └── event.py
│   └── routers/             # API Endpoints
│       ├── __init__.py
│       ├── health.py        # /api/v1/health with DB & Redis status checks
│       └── services.py      # /api/v1/services catalog
├── .env.example             # Template for environment configuration
├── Dockerfile               # Production container image
├── docker-compose.yml       # Multi-container orchestration (DB, Redis, Backend)
└── requirements.txt         # Python package dependencies
```

---

## 🗄️ Database Models (PostgreSQL)

| Model | Table | Description |
| :--- | :--- | :--- |
| **`Student`** | `students` | Stores student ID, full name, email, department/course, active status, and timestamps. |
| **`Service`** | `services` | Stores academic services (`exam`, `scholarship`, `course`), deadlines, status badges, and capacity. |
| **`Application`** | `applications` | Stores submitted application payloads (JSON), unique reference code (`FF-XXXX`), student FK, service FK, and status. |
| **`Event`** | `events` | High-frequency telemetry log for rate limiting, traffic surges, queue positions, and audit trails. |

---

## 🚀 Quickstart: Running with Docker Compose (Recommended)

To start PostgreSQL, Redis, and the FastAPI backend all in one command:

```bash
# From the project root or from the backend/ directory:
docker compose up --build
```

This starts:
- **PostgreSQL**: `localhost:5432` (`fairform_db`, user: `fairform_user`, password: `fairform_password`)
- **Redis**: `localhost:6379`
- **FastAPI Backend**: `http://localhost:8000`
- **Interactive Swagger Docs**: `http://localhost:8000/docs`
- **Health Check**: `http://localhost:8000/api/v1/health`

---

## 🛠️ Local Development Setup (Manual)

### 1. Create a Python Virtual Environment

```bash
cd backend
python -m venv venv

# Activate virtual environment:
# On macOS / Linux:
source venv/bin/activate
# On Windows:
venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Start PostgreSQL and Redis

You can start just PostgreSQL and Redis using Docker:

```bash
docker compose up db redis -d
```

Or ensure local instances are running on their default ports:
- PostgreSQL on `localhost:5432` with database `fairform_db`
- Redis on `localhost:6379`

### 4. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Adjust any credentials in `.env` if your local database credentials differ.

### 5. Start the FastAPI Development Server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

## 🧪 Verification & Testing

Once running:
- Open `http://localhost:8000` to view the API welcome payload.
- Open `http://localhost:8000/docs` for interactive Swagger UI documentation.
- Open `http://localhost:8000/api/v1/health` to confirm database and Redis connectivity.
- Open `http://localhost:8000/api/v1/services` to query academic services from PostgreSQL.

---

## 🚦 Virtual Waiting Room Endpoints (Redis Sorted Sets)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/queue/join` | Join service queue. Enforces 5 joins / 60s rate limit. Returns position, wait time, or admission token. |
| `GET` | `/api/queue/status` | Polls current position, students ahead, and admission status. Updates heartbeat. |
| `DELETE` | `/api/queue/leave` | Safely removes student from Redis Sorted Set and revokes admission token. |

### Testing with Multiple Students:
```bash
# Student 1 joins (Admitted if capacity >= 1)
curl -X POST http://localhost:8000/api/queue/join \
  -H "Content-Type: application/json" \
  -d '{"student_id":"STU-2026-001","service_code":"exam"}'

# Student 2 joins (Enters queue behind Student 1)
curl -X POST http://localhost:8000/api/queue/join \
  -H "Content-Type: application/json" \
  -d '{"student_id":"STU-2026-002","service_code":"exam"}'

# Poll status for Student 2
curl "http://localhost:8000/api/queue/status?student_id=STU-2026-002&service_code=exam"

# Student 1 leaves
curl -X DELETE "http://localhost:8000/api/queue/leave?student_id=STU-2026-001&service_code=exam"
```
