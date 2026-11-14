from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment (and `.env` in development). No secret has a default."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="LOGTAX_", extra="ignore")

    environment: str = "development"
    log_level: str = "INFO"
    # Origins allowed to call the API from a browser. Empty = none.
    cors_origins: list[str] = []
    # Supabase project the API authenticates against (filled in by the JWT/RLS work).
    supabase_url: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
