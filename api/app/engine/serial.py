"""Output types of the engine are plain dataclasses; this base makes the API serialise them in camelCase.

The front-end and the chat tools already speak camelCase (`monthlyTotal`, `rulesUsed`), so the OpenAPI contract does too.
"""

from typing import ClassVar

from pydantic import ConfigDict
from pydantic.alias_generators import to_camel


class Camel:
    __pydantic_config__: ClassVar[ConfigDict] = ConfigDict(alias_generator=to_camel, populate_by_name=True)
