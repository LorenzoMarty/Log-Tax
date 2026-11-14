# Log Tax API (FastAPI)

The backend of Log Tax. The Next.js app is only the interface; every calculation, chat turn and data operation goes through
this service (epic #287). Auth is the Supabase JWT of the user, and data access keeps the Row Level Security policies.

## Run

```sh
cd api
poetry install
poetry run uvicorn app.main:app --reload --port 8100
# http://localhost:8100/health   http://localhost:8100/docs
```

## Checks (the same as CI)

```sh
poetry run ruff check . && poetry run ruff format --check .
poetry run mypy
poetry run lint-imports
poetry run pytest          # coverage must stay at 85% or more
```

## Layout

| Folder | What lives there |
|---|---|
| `app/core` | settings, JSON logging with `request_id`, the single error model, middleware |
| `app/api` | HTTP routes (`/health`, `/v1/...`); thin: validate, call, return |
| `app/engine` | the tax engine: pure code, never imports `chat`, `db` or `api` |
| `app/chat` | the assistant: orchestrator, tools, OpenAI client |
| `app/db` | access to Supabase through the user's session (RLS) |

Boundaries are enforced by `import-linter` (`.importlinter`). Money is always integer cents or `Decimal`, never `float`.
