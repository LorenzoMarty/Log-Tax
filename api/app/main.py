from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    account,
    alert_events,
    chat,
    company_lookup,
    cron,
    document_search,
    documents,
    engine,
    health,
    me,
    missing_documents,
    nfe_import,
    organized_documents,
    report,
    sharing,
    usage,
    vitals,
    workspaces,
)
from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import request_context


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="Log Tax API", version="0.1.0", docs_url="/docs" if settings.environment != "production" else None)
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
    app.include_router(company_lookup.router)
    app.include_router(vitals.router)
    app.include_router(engine.router)
    app.include_router(chat.router)
    app.include_router(document_search.router)  # before documents.router, harmless either way: /search is a fixed path
    app.include_router(documents.router)
    app.include_router(nfe_import.router)
    app.include_router(organized_documents.router)
    app.include_router(cron.router)
    app.include_router(account.router)
    app.include_router(report.router)
    app.include_router(sharing.router)
    app.include_router(workspaces.router)
    app.include_router(alert_events.router)
    app.include_router(missing_documents.router)
    app.include_router(usage.router)
    return app


app = create_app()
