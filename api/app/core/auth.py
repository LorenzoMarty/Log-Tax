"""Authentication: the user's Supabase JWT is validated here and passed on, so RLS keeps deciding access."""

import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, Request
from jwt import PyJWKClient

from app.core.config import Settings, get_settings
from app.core.errors import AccountSuspendedError
from app.core.logging import log


@dataclass(frozen=True)
class Principal:
    """The authenticated caller. `token` is forwarded to the database; it is never logged."""

    user_id: uuid.UUID
    email: str | None
    token: str


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=401, headers={"WWW-Authenticate": "Bearer"})


@lru_cache
def _jwks(url: str) -> PyJWKClient:
    return PyJWKClient(url, cache_keys=True, lifespan=600)


_ASYMMETRIC = {"RS256", "ES256"}


def _decode(token: str, settings: Settings) -> dict[str, Any]:
    """Signature, `exp`, `aud` and (when the project URL is known) `iss`.

    The key is chosen by the token's algorithm, and only these are accepted: HS256 with the project's shared secret, or
    RS256/ES256 with the project's JWKS. Anything else (including `none`) is rejected: a token cannot pick its check.
    """
    options = {"require": ["exp", "sub", "aud"]}
    issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1" if settings.supabase_url else None
    algorithm = jwt.get_unverified_header(token).get("alg")
    key: Any
    if algorithm == "HS256" and settings.supabase_jwt_secret:
        key = settings.supabase_jwt_secret
    elif algorithm in _ASYMMETRIC and issuer:
        key = _jwks(f"{issuer}/.well-known/jwks.json").get_signing_key_from_jwt(token).key
    else:
        raise jwt.InvalidAlgorithmError("algorithm not accepted")
    return jwt.decode(token, key, algorithms=[str(algorithm)], audience="authenticated", issuer=issuer, options=options)  # type: ignore[arg-type]


def authenticate(authorization: str | None, settings: Settings) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauthorized()
    token = authorization[7:].strip()
    try:
        claims = _decode(token, settings)
        if claims.get("role") != "authenticated":
            raise jwt.InvalidTokenError("not a user token")
        user_id = uuid.UUID(str(claims["sub"]))
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        # The reason goes to the log (type only); the caller just learns the token was not accepted.
        log.info("auth_rejected", extra={"reason": type(exc).__name__})
        raise _unauthorized() from exc
    return Principal(user_id=user_id, email=claims.get("email"), token=token)


async def _is_suspended(principal: Principal, settings: Settings) -> bool:
    """Reads the caller's own `user_status` row (RLS lets a person see only theirs). A failed lookup does not lock people out."""
    if not (settings.supabase_url and settings.supabase_anon_key):
        return False
    headers = {"Authorization": f"Bearer {principal.token}", "apikey": settings.supabase_anon_key}
    params = {"select": "suspended", "user_id": f"eq.{principal.user_id}"}
    try:
        async with httpx.AsyncClient(base_url=settings.supabase_url.rstrip("/"), timeout=5) as http:
            res = await http.get("/rest/v1/user_status", params=params, headers=headers)
        # ponytail: one extra query per request; cache a few seconds per user if it shows up in latency
        return res.status_code < 400 and any(r.get("suspended") for r in res.json())
    except (httpx.HTTPError, ValueError):
        log.warning("suspension_check_failed")
        return False


async def current_user(
    request: Request, authorization: Annotated[str | None, Header()] = None, settings: Settings = Depends(get_settings)
) -> Principal:
    principal = authenticate(authorization, settings)
    request.state.user_id = str(principal.user_id)  # for the request log: an opaque id, never the token
    if await _is_suspended(principal, settings):
        raise AccountSuspendedError
    return principal
