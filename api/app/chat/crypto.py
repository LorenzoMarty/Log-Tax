"""Field-level encryption for identifiers (the CNPJ in the workspace profile): AES-256-GCM, a fresh IV per value.

Same format as `src/lib/crypto.ts`, so rows written by either side open on the other:
`enc:<keyId>:<iv>.<tag>.<ciphertext>` (unpadded base64url). The key lives in the environment, never in the database.
Outside production a fixed key is used so local runs and tests need no setup; production refuses a missing key.
Rotation: new key + new id as DATA_ENCRYPTION_KEY(_ID); old ones stay as DATA_ENCRYPTION_KEY_<ID> so old values still open.
"""

import base64
import os
import secrets
from collections.abc import Mapping

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import Settings

PREFIX = "enc:"
_DEV_KEY = bytes([7]) * 32


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def is_encrypted(value: object) -> bool:
    return isinstance(value, str) and value.startswith(PREFIX)


def key_for(key_id: str, settings: Settings, environ: Mapping[str, str] | None = None) -> bytes:
    env = os.environ if environ is None else environ
    raw = (
        settings.data_encryption_key
        if key_id == settings.data_encryption_key_id
        else env.get(f"DATA_ENCRYPTION_KEY_{key_id.upper()}", "")
    )
    if not raw:
        if settings.environment == "production":
            raise RuntimeError(f'encryption key "{key_id}" is not configured (DATA_ENCRYPTION_KEY)')
        return _DEV_KEY
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise ValueError("DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded")
    return key


def encrypt_field(plain: str, settings: Settings, environ: Mapping[str, str] | None = None) -> str:
    if is_encrypted(plain):
        return plain  # already sealed: do not double-encrypt
    key_id = settings.data_encryption_key_id
    iv = secrets.token_bytes(12)
    sealed = AESGCM(key_for(key_id, settings, environ)).encrypt(iv, plain.encode(), None)
    body, tag = sealed[:-16], sealed[-16:]
    return f"{PREFIX}{key_id}:{_b64(iv)}.{_b64(tag)}.{_b64(body)}"


def decrypt_field(value: str, settings: Settings, environ: Mapping[str, str] | None = None) -> str:
    if not is_encrypted(value):
        return value  # legacy or plain value
    key_id, rest = value[len(PREFIX) :].split(":", 1)
    iv, tag, body = (_unb64(p) for p in rest.split("."))
    return AESGCM(key_for(key_id, settings, environ)).decrypt(iv, body + tag, None).decode()
