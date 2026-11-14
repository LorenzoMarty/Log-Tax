"""Authentication: the user's Supabase JWT is validated here and passed on, so RLS keeps deciding access."""

import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, Header, HTTPException
from jwt import PyJWKClient

from app.core.config import Settings, get_settings
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


async def current_user(
    authorization: Annotated[str | None, Header()] = None, settings: Settings = Depends(get_settings)
) -> Principal:
    return authenticate(authorization, settings)
