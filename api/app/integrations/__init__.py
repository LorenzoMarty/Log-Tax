"""Integration providers (#167): what a connector must do, plus the registry. The credentials are a plain dict to the provider."""

from typing import Protocol


class SyncError(Exception):
    """The provider could not sync. The message is shown to the owner, so it must never carry the credential."""


class Provider(Protocol):
    async def sync(self, credentials: dict[str, str]) -> None: ...


class FakeProvider:
    """The example connector: syncs unless the credential says `token: "bad"` (used by the tests)."""

    async def sync(self, credentials: dict[str, str]) -> None:
        if credentials.get("token") == "bad":
            raise SyncError("A credencial foi recusada pelo serviço.")


# ponytail: one provider; a real connector is added here, generalize when the second arrives.
PROVIDERS: dict[str, Provider] = {"exemplo": FakeProvider()}
