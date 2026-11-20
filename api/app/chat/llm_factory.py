"""OpenAI by default. `LOG_TAX_LLM=scripted` swaps in the keyword-driven stand-in, and is refused in production."""

from app.chat.openai_llm import create_openai_llm
from app.chat.scripted_llm import scripted_llm
from app.chat.types import LlmClient
from app.core.config import Settings, get_settings


def get_llm(settings: Settings | None = None) -> LlmClient:
    s = settings or get_settings()
    if s.llm == "scripted" and s.environment != "production":
        return scripted_llm
    return create_openai_llm(s.openai_api_key, s.openai_model)
