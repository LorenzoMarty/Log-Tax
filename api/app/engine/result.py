"""What an engine call answers. Never an invented number: missing data, "not applicable" and "nothing found" are explicit."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Ok[T]:
    value: T


@dataclass(frozen=True)
class InsufficientData:
    missing: list[str]


@dataclass(frozen=True)
class NotApplicable:
    reason: str


@dataclass(frozen=True)
class NoneFound:
    pass


type EngineResult[T] = Ok[T] | InsufficientData | NotApplicable | NoneFound
