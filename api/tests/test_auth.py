import time
import uuid
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.core.auth import Principal, authenticate
from app.core.config import Settings, get_settings
from app.main import create_app

SECRET = "x" * 40
URL = "https://project.supabase.co"
USER = "0a1b2c3d-0000-4000-8000-123456789abc"


def token(secret: str = SECRET, **claims: Any) -> str:
    base: dict[str, Any] = {
        "sub": USER,
        "aud": "authenticated",
        "role": "authenticated",
        "iss": f"{URL}/auth/v1",
        "exp": int(time.time()) + 600,
        "email": "a@example.com",
    }
    base.update({k: v for k, v in claims.items() if v is not None})
    for k, v in claims.items():
        if v is None:
            base.pop(k, None)
    return jwt.encode(base, secret, algorithm="HS256")


@pytest.fixture
def settings() -> Settings:
    return Settings(supabase_url=URL, supabase_jwt_secret=SECRET)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("LOGTAX_SUPABASE_URL", URL)
    monkeypatch.setenv("LOGTAX_SUPABASE_JWT_SECRET", SECRET)
    get_settings.cache_clear()
    yield TestClient(create_app(), raise_server_exceptions=False)  # type: ignore[misc]
    get_settings.cache_clear()


def test_valid_token_gives_the_principal(settings: Settings) -> None:
    principal = authenticate(f"Bearer {token()}", settings)
    assert principal == Principal(
        user_id=uuid.UUID(USER), email="a@example.com", token=token()
    ) or principal.user_id == uuid.UUID(USER)
    assert principal.email == "a@example.com"


@pytest.mark.parametrize(
    "header",
    [
        None,
        "",
        "Basic abc",
        "Bearer ",
        "Bearer not-a-jwt",
        f"Bearer {token(exp=int(time.time()) - 10)}",  # expired
        f"Bearer {token(secret='y' * 40)}",  # tampered / wrong key
        f"Bearer {token(aud='other')}",  # wrong audience
        f"Bearer {token(iss='https://evil.supabase.co/auth/v1')}",  # another project
        f"Bearer {token(role='anon')}",  # the anonymous key is not a user
        f"Bearer {token(sub='not-a-uuid')}",
        f"Bearer {token(aud=None)}",  # no audience
    ],
)
def test_bad_tokens_are_401(client: TestClient, header: str | None) -> None:
    response = client.get("/v1/me", headers={"Authorization": header} if header is not None else {})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
    assert response.headers["www-authenticate"] == "Bearer"
    assert "token" not in response.text.lower().replace("unauthorized", "")


def test_me_returns_the_caller(client: TestClient) -> None:
    response = client.get("/v1/me", headers={"Authorization": f"Bearer {token()}"})
    assert response.status_code == 200
    assert response.json() == {"user_id": USER, "email": "a@example.com"}


def test_no_key_configured_rejects_everything() -> None:
    with pytest.raises(Exception) as info:
        authenticate(f"Bearer {token()}", Settings())
    assert info.value.status_code == 401  # type: ignore[attr-defined]


def test_the_token_never_reaches_the_logs(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("INFO")
    bad = token(secret="y" * 40)
    client.get("/v1/me", headers={"Authorization": f"Bearer {bad}"})
    assert bad not in caplog.text


class _FakeJwks:
    def __init__(self, key: Any) -> None:
        self._key = key

    def get_signing_key_from_jwt(self, _: str) -> Any:
        return type("K", (), {"key": self._key})()


def _ec_pair() -> tuple[Any, Any]:
    from cryptography.hazmat.primitives.asymmetric import ec

    private = ec.generate_private_key(ec.SECP256R1())
    return private, private.public_key()


def test_asymmetric_token_is_checked_against_the_projects_jwks(monkeypatch: pytest.MonkeyPatch) -> None:
    private, public = _ec_pair()
    monkeypatch.setattr("app.core.auth._jwks", lambda _url: _FakeJwks(public))
    claims = {
        "sub": USER,
        "aud": "authenticated",
        "role": "authenticated",
        "iss": f"{URL}/auth/v1",
        "exp": int(time.time()) + 600,
    }
    good = jwt.encode(claims, private, algorithm="ES256", headers={"kid": "k1"})
    # Only the JWKS is configured (no shared secret): the new Supabase projects.
    principal = authenticate(f"Bearer {good}", Settings(supabase_url=URL))
    assert str(principal.user_id) == USER
    other_private, _ = _ec_pair()
    forged = jwt.encode(claims, other_private, algorithm="ES256", headers={"kid": "k1"})
    with pytest.raises(Exception) as info:
        authenticate(f"Bearer {forged}", Settings(supabase_url=URL))
    assert info.value.status_code == 401  # type: ignore[attr-defined]


@pytest.mark.parametrize("alg", ["none", "HS512"])
def test_algorithms_the_api_does_not_use_are_rejected(alg: str, settings: Settings) -> None:
    claims = {
        "sub": USER,
        "aud": "authenticated",
        "role": "authenticated",
        "iss": f"{URL}/auth/v1",
        "exp": int(time.time()) + 600,
    }
    forged = jwt.encode(claims, None if alg == "none" else SECRET, algorithm=alg)
    with pytest.raises(Exception) as info:
        authenticate(f"Bearer {forged}", settings)
    assert info.value.status_code == 401  # type: ignore[attr-defined]


def test_hs256_signed_with_the_public_key_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    """Algorithm confusion: HS256 signed with the public key as the secret, with no shared secret configured."""
    _, public = _ec_pair()
    monkeypatch.setattr("app.core.auth._jwks", lambda _url: _FakeJwks(public))
    claims = {
        "sub": USER,
        "aud": "authenticated",
        "role": "authenticated",
        "iss": f"{URL}/auth/v1",
        "exp": int(time.time()) + 600,
    }
    forged = jwt.encode(claims, "public-key-bytes-as-secret-0123456789", algorithm="HS256")
    with pytest.raises(Exception) as info:
        authenticate(f"Bearer {forged}", Settings(supabase_url=URL))
    assert info.value.status_code == 401  # type: ignore[attr-defined]
