import time
from collections.abc import Iterator
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import create_app

SECRET = "x" * 40
URL = "https://project.supabase.co"
USER = "0a1b2c3d-0000-4000-8000-123456789abc"


def make_token(**claims: Any) -> str:
    base: dict[str, Any] = {
        "sub": USER,
        "aud": "authenticated",
        "role": "authenticated",
        "iss": f"{URL}/auth/v1",
        "email": "a@example.com",
    }
    base["exp"] = int(time.time()) + 600
    return jwt.encode({**base, **claims}, SECRET, algorithm="HS256")


@pytest.fixture
def signed_in(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """A client for an app configured against a fake Supabase project, already carrying a valid user token."""
    monkeypatch.setenv("LOGTAX_SUPABASE_URL", URL)
    monkeypatch.setenv("LOGTAX_SUPABASE_JWT_SECRET", SECRET)
    get_settings.cache_clear()
    client = TestClient(create_app(), raise_server_exceptions=False, headers={"Authorization": f"Bearer {make_token()}"})
    yield client
    get_settings.cache_clear()


@pytest.fixture
def anonymous(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("LOGTAX_SUPABASE_URL", URL)
    monkeypatch.setenv("LOGTAX_SUPABASE_JWT_SECRET", SECRET)
    get_settings.cache_clear()
    yield TestClient(create_app(), raise_server_exceptions=False)
    get_settings.cache_clear()
