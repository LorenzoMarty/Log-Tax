"""Writes the OpenAPI contract to `api/openapi.json` (the file the TypeScript client is generated from).

poetry run python -m scripts.export_openapi          # rewrite the file
poetry run python -m scripts.export_openapi --check  # exit 1 when the committed file is out of date (CI)
"""

import json
import sys
from pathlib import Path

from app.main import create_app

TARGET = Path(__file__).resolve().parent.parent / "openapi.json"


def render() -> str:
    return json.dumps(create_app().openapi(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> int:
    text = render()
    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8").replace("\r\n", "\n") if TARGET.exists() else ""
        if current != text:
            sys.stderr.write("api/openapi.json is out of date: run `poetry run python -m scripts.export_openapi`\n")
            return 1
        return 0
    TARGET.write_text(text, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
