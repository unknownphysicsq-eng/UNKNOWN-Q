# FairForm AI — Full-Stack Academic Portal

FairForm AI is a secure, fair-access academic portal featuring a virtual waiting room queue, rate limiting, student application forms, and real-time administrative traffic analytics.

---

## 🏗️ Architecture Overview

The application features:
1. **Frontend (React + Vite + Tailwind CSS)**:
   - Three academic services: **Exam Registration**, **Scholarship Application**, and **Course Enrollment**.
   - Student dashboard, dynamic form submission, user profile settings, and application history.
   - Administrative portal with live traffic charts, service queue lengths, and rejection telemetry.
2. **Backend Server (`server.ts` & FastAPI in `/backend`)**:
   - **Authentication**: Cryptographically signed HS256 JWT tokens, PBKDF2/bcrypt password hashing, account deactivation checks, and strict credential validation.
   - **Role-Based Access Control (RBAC)**: Distinct permissions for `student` vs `admin` roles. Admin endpoints reject unauthenticated requests with HTTP 401 and non-admin students with HTTP 403.
   - **Virtual Waiting Room**: Redis Sorted Set simulation enforcing strict FIFO arrival ordering, configurable concurrent admission capacity, heartbeat tracking, and automatic token issuance.
   - **Admission Pass Tokens**: Cryptographic, short-lived tokens (10-minute TTL) required for application submissions. Submissions without a valid token, with another student's token, with a token for another service, or with an expired/consumed token are rejected with HTTP 403.
   - **Server-Side Validation**: Strict schema validation for all academic services (minimum character lengths, student ID match, valid CGPA between 0.0 and 10.0, semester choices, declaration acceptance).
   - **Duplicate Prevention**: Concurrency double-click locks (HTTP 409) and strict one-application-per-service business rule enforcement (HTTP 409).
   - **Sliding-Window Rate Limiting**: 5 queue joins per 60s and 5 failed login attempts per 60s. Enforces HTTP 429 Too Many Requests with mandatory `Retry-After: <seconds>` HTTP response headers.
   - **Database Persistence**: Automatic file-backed disk persistence (`./data/fairform_db.json`) that survives server restarts.

---

## 🚀 Running the Project Locally

### Option 1: Full-Stack Node/TypeScript (Default AI Studio Runtime)

This runs the unified Express backend and Vite frontend dev server with persistent database storage on Port 3000:

```bash
# 1. Install dependencies
npm install

# 2. Start the full-stack dev server (Port 3000)
npm run dev
```

Open `http://localhost:3000` in your browser.

#### Running Automated API Tests:
```bash
npm test
# Or directly:
npx tsx tests/api.test.ts
```

---

### Option 2: Multi-Container Setup via Docker Compose

To run the complete stack including PostgreSQL 16, Redis 7, and the Python FastAPI backend:

```bash
# From project root:
docker compose up --build
```

Services:
- **FastAPI API & Documentation**: `http://localhost:8000/docs`
- **PostgreSQL Database**: `localhost:5432` (`fairform_db`, user: `fairform_user`, password: `fairform_password`)
- **Redis Server**: `localhost:6379`
- **Health Endpoint**: `http://localhost:8000/api/v1/health`

---

### Option 3: Manual Python FastAPI Backend Setup

```bash
cd backend

# 1. Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env

# 4. Start PostgreSQL and Redis (e.g. via docker compose up db redis -d)
# Or configure DATABASE_URL in .env (SQLite fallback is also supported: sqlite:///./fairform.db)

# 5. Seed initial accounts and services
python -m app.seed

# 6. Start the FastAPI server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

## 🔑 Default Seed Credentials

| Role | Student ID | Password | Department / Description |
| :--- | :--- | :--- | :--- |
| **Student** | `STU-2026-001` | `Password@123` | Computer Science and Engineering (CSE) |
| **Student** | `STU-2026-002` | `Password@123` | Artificial Intelligence and Data Science (AI & DS) |
| **Admin** | `ADMIN-001` | `Admin@Secure2026` | Academic Administration |

---

## 🧪 Automated Test Suite Report

All 43 automated tests were executed and passed (43/43):

| Test Suite Category | Tests Run | Result | Notes |
| :--- | :---: | :---: | :--- |
| **1. Login & Credentials Security** | 6 | **PASS** | Validates 400 for empty body, 401 for unknown ID, 401 for wrong password, and successful JWT issuance for students & admin. |
| **2. JWT Verification & Cryptographic Security** | 6 | **PASS** | Rejects missing Authorization header (401), malformed JWT (401), forged signature (401), expired JWT (401), and query parameter auth bypass (401). |
| **3. Role-Based Access Control (RBAC)** | 5 | **PASS** | Rejects unauthenticated admin calls (401), rejects student role calling admin endpoints (403 Forbidden), allows admin role (200 OK). |
| **4. Virtual Waiting Room & Capacity** | 5 | **PASS** | Enforces FIFO arrival order, capacity limits (capacity=1 admits first student and queues subsequent students), preserves queue position on re-join, auto-advances waiting students when front of queue leaves. |
| **5. Admission Token Anti-Bypass** | 5 | **PASS** | Rejects submission without token (403), fake token (403), cross-service token (403), and another student's token (403). |
| **6. Server-Side Validation** | 5 | **PASS** | Rejects short fullName (422), studentId mismatch (422), missing department (422), unaccepted declaration (422), and missing exam semester (422). |
| **7. Duplicate Submissions** | 3 | **PASS** | Valid submission returns 201 Created with unique reference; replaying consumed token rejected (403); duplicate submission for same service rejected (409 Conflict). |
| **8. Rate Limiting & Retry-After Headers** | 2 | **PASS** | 6th queue join in 60s returns 429 with `Retry-After` header; 6th failed login attempt in 60s returns 429 with `Retry-After` header. |
| **9. Profile Updates & Admin Metrics** | 5 | **PASS** | Rejects empty name (422), rejects role escalation (403), rejects student ID alteration (400), updates name/course, logs `PROFILE_UPDATED` event, verifies admin metrics. |
| **10. Database Persistence Across Restart** | 1 | **PASS** | Re-hydrating database from disk (`loadDatabase()`) verifies submitted application and updated student profile persist without loss. |

---

## ⚠️ Remaining Limitations

1. **Distributed Multi-Node Clustered Redis**: The simulated environment runs an in-memory sliding window and sorted set engine backed by local disk storage (`data/fairform_db.json`). For a multi-node horizontal cluster behind a load balancer, run an external Redis cluster as defined in `docker-compose.yml`.
2. **Third-Party Email Verification**: Email format is validated on the server, but transactional email sending (e.g. SMTP / SendGrid) is not configured by default.
