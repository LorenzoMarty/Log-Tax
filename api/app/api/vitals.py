from typing import Annotated, Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.core.logging import log

router = APIRouter()


class Vital(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)

    name: Literal["LCP", "INP", "CLS", "FCP", "TTFB"]
    value: Annotated[float, Field(ge=0, le=600_000)]
    rating: Literal["good", "needs-improvement", "poor"]
    path: Annotated[str, Field(max_length=120)]
    navigation_type: Annotated[str, Field(max_length=30)] | None = None


@router.post("/v1/vitals", status_code=204, tags=["ops"])
async def vitals(body: Vital) -> Response:
    """Receives one Web Vital from a real visit and logs it (CLS is sent times 1000). Public and tiny: no user data accepted."""
    log.info(
        "web_vital",
        extra={
            "metric": body.name,
            "amount": body.value,
            "rating": body.rating,
            "path": body.path,
            "navigation_type": body.navigation_type,
        },
    )
    return Response(status_code=204)
