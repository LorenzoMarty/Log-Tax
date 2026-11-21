from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import log, request_id_var


class DbError(Exception):
    """The Data API refused or failed. `status` is what PostgREST answered; the detail is never shown to the client."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status


class TooManyRequestsError(Exception):
    """A budget was spent: the client must wait `retry_after` seconds."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(f"too many requests, retry after {retry_after}s")
        self.retry_after = retry_after


class PlanLimitError(Exception):
    """The caller's plan does not allow this: answered as 402 with a message that points to the upgrade."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class AccountSuspendedError(Exception):
    """The caller's account was suspended by a platform admin (#201): every authenticated route answers 403."""


class AccountStatusUnavailableError(Exception):
    """The suspension lookup failed (#393): answering would mean guessing, so the request is refused with 503 (fail closed)."""


class ErrorBody(BaseModel):
    code: str
    message: str
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorBody


def error_response(status: int, code: str, message: str) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message, request_id=request_id_var.get()))
    return JSONResponse(status_code=status, content=body.model_dump())


_HTTP_MESSAGES = {
    401: ("unauthorized", "Faça login para continuar."),
    403: ("forbidden", "Você não tem acesso a isso."),
    404: ("not_found", "Não encontrei o que você pediu."),
    429: ("too_many_requests", "Muitas tentativas em pouco tempo. Tente de novo em instantes."),
}


def db_error_status(status: int) -> tuple[int, str, str]:
    """What the client learns when the database refuses: RLS denials look like "not found", never like details."""
    if status in (401, 403):
        return 403, *_HTTP_MESSAGES[403]
    if status == 404:
        return 404, *_HTTP_MESSAGES[404]
    return 502, "upstream_error", "Não consegui falar com o banco agora. Tente de novo."


def install_error_handlers(app: FastAPI) -> None:
    # Starlette's class is the base of FastAPI's, so this also covers unknown routes (404) and wrong methods (405).
    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = _HTTP_MESSAGES.get(exc.status_code, ("error", "Não foi possível concluir a solicitação."))
        response = error_response(exc.status_code, code, message)
        if exc.headers:
            response.headers.update(exc.headers)
        return response

    @app.exception_handler(TooManyRequestsError)
    async def _too_many(_: Request, exc: TooManyRequestsError) -> JSONResponse:
        response = error_response(
            429, "too_many_requests", f"Muitas tentativas em pouco tempo. Tente de novo em {exc.retry_after} s."
        )
        response.headers["Retry-After"] = str(exc.retry_after)
        return response

    @app.exception_handler(PlanLimitError)
    async def _plan_limit(_: Request, exc: PlanLimitError) -> JSONResponse:
        return error_response(402, "plan_limit", exc.message)

    @app.exception_handler(AccountSuspendedError)
    async def _suspended(_: Request, __: AccountSuspendedError) -> JSONResponse:
        return error_response(403, "account_suspended", "Conta suspensa. Fale com o suporte.")

    @app.exception_handler(AccountStatusUnavailableError)
    async def _status_unavailable(_: Request, __: AccountStatusUnavailableError) -> JSONResponse:
        return error_response(
            503, "account_status_unavailable", "Não consegui confirmar o estado da sua conta agora. Tente de novo."
        )

    @app.exception_handler(DbError)
    async def _db(_: Request, exc: DbError) -> JSONResponse:
        status, code, message = db_error_status(exc.status)
        log.info("db_refused", extra={"db_status": exc.status})
        return error_response(status, code, message)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, __: RequestValidationError) -> JSONResponse:
        return error_response(422, "invalid_request", "Os dados enviados não são válidos.")

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        # The cause goes to the log (type only, never the content); the client gets a generic message.
        log.error("unhandled_error", extra={"error_type": type(exc).__name__})
        return error_response(500, "internal_error", "Algo deu errado do nosso lado. Tente de novo.")
