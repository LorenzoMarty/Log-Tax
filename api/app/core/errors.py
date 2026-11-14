from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import log, request_id_var


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


def install_error_handlers(app: FastAPI) -> None:
    # Starlette's class is the base of FastAPI's, so this also covers unknown routes (404) and wrong methods (405).
    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = _HTTP_MESSAGES.get(exc.status_code, ("error", "Não foi possível concluir a solicitação."))
        response = error_response(exc.status_code, code, message)
        if exc.headers:
            response.headers.update(exc.headers)
        return response

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, __: RequestValidationError) -> JSONResponse:
        return error_response(422, "invalid_request", "Os dados enviados não são válidos.")

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        # The cause goes to the log (type only, never the content); the client gets a generic message.
        log.error("unhandled_error", extra={"error_type": type(exc).__name__})
        return error_response(500, "internal_error", "Algo deu errado do nosso lado. Tente de novo.")
