from functools import lru_cache
from pathlib import Path
from typing import List, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    database_url: str = "sqlite:///./treechat.db"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    auth_enabled: bool = Field(default=False, validation_alias="YGGDRASIL_AUTH_ENABLED")
    auth_username: str | None = Field(default=None, validation_alias="YGGDRASIL_AUTH_USERNAME")
    auth_password: SecretStr | None = Field(default=None, validation_alias="YGGDRASIL_AUTH_PASSWORD")
    auth_secret: SecretStr | None = Field(default=None, validation_alias="YGGDRASIL_AUTH_SECRET")
    auth_session_ttl_seconds: int = Field(
        default=7 * 24 * 60 * 60,
        ge=300,
        le=31 * 24 * 60 * 60,
        validation_alias="YGGDRASIL_AUTH_SESSION_TTL_SECONDS",
    )
    auth_cookie_secure: bool = Field(default=False, validation_alias="YGGDRASIL_AUTH_COOKIE_SECURE")

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_ROOT / ".env"),
        env_prefix="TREECHAT_",
        extra="ignore",
        populate_by_name=True,
    )

    @model_validator(mode="after")
    def validate_auth_configuration(self) -> Self:
        configured = {
            "YGGDRASIL_AUTH_USERNAME": bool(self.auth_username and self.auth_username.strip()),
            "YGGDRASIL_AUTH_PASSWORD": bool(self.auth_password and self.auth_password.get_secret_value()),
            "YGGDRASIL_AUTH_SECRET": bool(self.auth_secret and self.auth_secret.get_secret_value()),
        }

        if not self.auth_enabled:
            unexpected = [name for name, present in configured.items() if present]
            if unexpected:
                names = ", ".join(unexpected)
                raise ValueError(
                    f"YGGDRASIL_AUTH_ENABLED is false, but {names} is configured; "
                    "enable authentication or remove the unused credentials"
                )
            return self

        missing = [name for name, present in configured.items() if not present]
        if missing:
            raise ValueError(
                "Authentication is enabled but required configuration is missing: " + ", ".join(missing)
            )

        password = self.auth_password.get_secret_value() if self.auth_password else ""
        if len(password) < 12:
            raise ValueError("YGGDRASIL_AUTH_PASSWORD must contain at least 12 characters")

        secret = self.auth_secret.get_secret_value() if self.auth_secret else ""
        if len(secret.encode("utf-8")) < 32:
            raise ValueError("YGGDRASIL_AUTH_SECRET must contain at least 32 UTF-8 bytes")

        self.auth_username = self.auth_username.strip() if self.auth_username else None
        return self

    @property
    def cors_origin_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
