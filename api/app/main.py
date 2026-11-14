from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, me
from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import request_context


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(
        title="Log Tax API", version="0.1.0", docs_url="/docs" if settings.environment != "production" else None
    )
    app.middleware("http")(request_context)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "PATCH", "DELETE"],
            allow_headers=["authorization", "content-type", "x-request-id"],
        )
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(me.router)
    return app


app = create_app()
