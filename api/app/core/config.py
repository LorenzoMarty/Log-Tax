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
    # Publishable (anon) key: identifies the project to the Data API; the user's JWT is what grants access.
    supabase_anon_key: str = ""
    # HS256 secret of projects that sign with a shared secret (the local Supabase). Empty = use the project's JWKS.
    supabase_jwt_secret: str = ""
    # Service-role key: ONLY for the isolated system tasks in `app.tasks` (cron, account deletion). Never for user data.
    supabase_service_role_key: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
