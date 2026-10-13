import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import init_db, SessionLocal
from app.seed import seed_database
from app.routers import health, services, auth, admin, queue, applications, me

# Lifespan and app definition remain above...

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fairform.backend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan context manager:
    Initializes PostgreSQL schema and seeds test students & admin accounts on startup.
    """
    logger.info("Starting up %s...", settings.APP_NAME)
    try:
        logger.info("Initializing PostgreSQL tables...")
        init_db()
        logger.info("Tables verified. Seeding initial accounts and services...")
        db = SessionLocal()
        try:
            seed_database(db)
        finally:
            db.close()
        logger.info("Initial accounts and catalog seeded.")
    except Exception as exc:
        logger.warning("Auto-initialization warning: %s", exc)

    yield

    logger.info("Shutting down %s...", settings.APP_NAME)


app = FastAPI(
    title=settings.APP_NAME,
    description="FairForm AI Backend API with PostgreSQL, Redis Sorted Set virtual waiting room, and JWT authentication.",
    version="0.3.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Configure Cross-Origin Resource Sharing (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Virtual Queue Router at both /api and /api/v1 for seamless compatibility
app.include_router(queue.router, prefix="/api")
app.include_router(queue.router, prefix=settings.API_V1_PREFIX)

# Mount Applications Router at both /api and /api/v1
app.include_router(applications.router, prefix="/api")
app.include_router(applications.router, prefix=settings.API_V1_PREFIX)

# Mount Profile Me Router at both /api and /api/v1 (GET /api/me, PUT /api/me)
app.include_router(me.router, prefix="/api")
app.include_router(me.router, prefix=settings.API_V1_PREFIX)

# Mount Services Catalog Router at both /api and /api/v1 (GET /api/services)
app.include_router(services.router, prefix="/api")
app.include_router(services.router, prefix=settings.API_V1_PREFIX)

# Mount Admin Portal Router at both /api and /api/v1 (GET /api/admin/stats, GET /api/admin/traffic)
app.include_router(admin.router, prefix="/api")
app.include_router(admin.router, prefix=settings.API_V1_PREFIX)

# Mount System & Auth Routers under API v1 prefix
app.include_router(health.router, prefix=settings.API_V1_PREFIX)
app.include_router(auth.router, prefix=settings.API_V1_PREFIX)


@app.get("/")
def root():
    """Root entrypoint returning backend health status and interactive documentation links."""
    return {
        "message": f"Welcome to {settings.APP_NAME} API",
        "version": "0.3.0",
        "environment": settings.ENVIRONMENT,
        "docs_url": "/docs",
        "health_check": f"{settings.API_V1_PREFIX}/health",
        "queue_endpoints": {
            "join": "/api/queue/join",
            "status": "/api/queue/status",
            "leave": "/api/queue/leave",
        },
        "auth_endpoints": {
            "login": f"{settings.API_V1_PREFIX}/auth/login",
            "me": f"{settings.API_V1_PREFIX}/auth/me",
        },
        "admin_endpoints": {
            "students": f"{settings.API_V1_PREFIX}/admin/students",
            "stats": f"{settings.API_V1_PREFIX}/admin/stats",
        },
    }
