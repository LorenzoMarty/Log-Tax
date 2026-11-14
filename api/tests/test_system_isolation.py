import pytest

from app.core.config import Settings
from app.tasks.system import service_client


async def test_service_client_needs_the_key() -> None:
    with pytest.raises(RuntimeError):
        async with service_client(Settings()):
            pass


async def test_service_client_uses_the_service_key() -> None:
    settings = Settings(supabase_url="https://p.supabase.co", supabase_service_role_key="srv-key")
    async with service_client(settings) as client:
        assert client.headers["authorization"] == "Bearer srv-key"
