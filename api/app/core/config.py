from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment (and `.env` in development). No secret has a default."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="LOGTAX_", extra="ignore", populate_by_name=True)

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
    # Chat model. Same variable names as the Next.js app used, so one `.env` serves both while they coexist.
    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    openai_model: str = Field(default="", validation_alias="OPENAI_MODEL")
    # "scripted" = deterministic stand-in for e2e/demos; ignored (OpenAI is used) when environment is production.
    llm: str = Field(default="", validation_alias="LOG_TAX_LLM")
    # "1" = a workspace with no data starts from the fictional demo company (e2e and demos); empty = it starts blank.
    demo_seed: str = Field(default="", validation_alias="LOG_TAX_DEMO_SEED")
    # Model tokens a user may spend per day (0 or invalid = the default).
    chat_daily_tokens: int = Field(default=200_000, validation_alias="CHAT_DAILY_TOKENS")
    # AES-256-GCM key (32 bytes, base64) for identifiers at rest (CNPJ), and its id. Old keys stay as DATA_ENCRYPTION_KEY_<ID>.
    data_encryption_key: str = Field(default="", validation_alias="DATA_ENCRYPTION_KEY")
    data_encryption_key_id: str = Field(default="k1", validation_alias="DATA_ENCRYPTION_KEY_ID")
    # Optional malware scanner for uploads (POST bytes, answers {"infected": boolean}) and the per-workspace document quota.
    virus_scan_url: str = Field(default="", validation_alias="VIRUS_SCAN_URL")
    document_quota_bytes: int = Field(default=0, validation_alias="DOCUMENT_QUOTA_BYTES")


@lru_cache
def get_settings() -> Settings:
    return Settings()
