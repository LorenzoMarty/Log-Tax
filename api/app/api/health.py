from fastapi import APIRouter

router = APIRouter()


@router.get("/health", tags=["ops"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/v1/ping", tags=["ops"])
async def ping() -> dict[str, str]:
    return {"pong": "ok"}
