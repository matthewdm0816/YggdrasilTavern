from __future__ import annotations

import base64
import io
import json
import logging
import re
import sqlite3

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin
from sqlalchemy import create_engine, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models, schemas
from app.api.profiles import discover_profile_models
from app.config import Settings
from app.database import Base, get_db
from app.main import create_app
from app.services import generation as generation_service, providers, token_counter
from app.services.errors import ApplicationError
from app.services.prompt_builder import LoreCandidate, _match_key, _regex_parts, activate_lore, build_context
from app.services.st_custom_params import convert_custom_request_settings
from app.services.st_import import load_character_upload, load_worldbook_upload
from app.services.tree import create_message


def _make_client():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    testing_session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def override_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    settings = Settings(_env_file=None, database_url="sqlite:///:memory:", auth_enabled=False)
    app = create_app(init_on_startup=False, settings=settings)
    app.dependency_overrides[get_db] = override_db
    return TestClient(app), testing_session


def test_count_text_tokens_handles_special_tokens_and_caches_encodings(monkeypatch, caplog):
    import tiktoken

    token_counter._get_encoding.cache_clear()
    try:
        special_text = "Alpha <|endoftext|> Beta <|fim_prefix|>"
        enc = tiktoken.get_encoding("cl100k_base")
        expected = len(enc.encode(special_text, disallowed_special=()))
        assert expected != token_counter._heuristic_token_count("<|endoftext|>")

        with caplog.at_level(logging.WARNING, logger=token_counter.__name__):
            assert token_counter.count_text_tokens("<|endoftext|>", "gpt-4") == len(
                enc.encode("<|endoftext|>", disallowed_special=())
            )
            assert token_counter.count_text_tokens(special_text, "claude-3-5-sonnet") == expected
            assert token_counter.count_text_tokens(special_text, "claude-3-5-sonnet") == expected
        assert caplog.records == []
        assert token_counter._get_encoding.cache_info().hits >= 1

        def broken_encoding_for_model(_model: str):
            raise RuntimeError("corrupt bpe rank table")

        monkeypatch.setattr(tiktoken, "encoding_for_model", broken_encoding_for_model)
        token_counter._get_encoding.cache_clear()
        with caplog.at_level(logging.WARNING, logger=token_counter.__name__):
            fallback_count = token_counter.count_text_tokens("hello <|endoftext|>", "broken-custom-model")
        assert fallback_count == len(enc.encode("hello <|endoftext|>", disallowed_special=()))
        assert any(
            "corrupt bpe rank table" in record.getMessage() and "broken-custom-model" in record.getMessage()
            for record in caplog.records
        )
    finally:
        token_counter._get_encoding.cache_clear()


def test_worldbook_regex_distinguishes_plain_paths_valid_regex_and_invalid_regex_diagnostics():
    assert _regex_parts("/api/v1/chat") is None
    assert _regex_parts("/api/v1/items") is None
    assert _regex_parts("//") is None
    assert _regex_parts("/citadel\\s+gate/im") == (r"citadel\s+gate", re.IGNORECASE | re.MULTILINE)

    with pytest.raises(re.error):
        _match_key("/[unclosed/i", "sample text", case_sensitive=False, whole_words=False)

    candidates = [
        LoreCandidate(id="path-entry", worldbook_id="wb", keys=["/api/v1/items"], secondary_keys=[], content="Path lore", order=1),
        LoreCandidate(id="regex-entry", worldbook_id="wb", keys=[r"/dragon\s+gate/i"], secondary_keys=[], content="Dragon lore", order=2),
    ]
    missed = activate_lore(
        candidates,
        [models.Message(session_id="s", role="user", speaker="User", content="Calling API/V1 now", sort_order=1)],
        scan_depth=4,
        budget=200,
    )
    assert [item.id for item in missed] == []

    matched = activate_lore(
        candidates,
        [models.Message(session_id="s", role="user", speaker="User", content="GET /api/v1/items near Dragon   Gate", sort_order=1)],
        scan_depth=4,
        budget=200,
    )
    assert [item.id for item in matched] == ["path-entry", "regex-entry"]

    client, testing_session = _make_client()
    with testing_session() as db:
        character = models.Character(name="Scholar", first_mes="")
        book = models.WorldBook(
            id="wb-regex-test",
            name="Regex Lore",
            scan_depth=8,
            token_budget=500,
            entries=[
                models.WorldBookEntry(id="bad-entry", keys=["/[unclosed/i"], content="Broken regex lore", order=1),
                models.WorldBookEntry(id="good-entry", keys=["/citadel/i"], content="Valid citadel lore", order=2),
            ],
        )
        profile = models.APIProfile(
            name="Test Profile",
            provider_type="openai_chat_completions",
            base_url="https://example.test",
            model="gpt-4",
            api_key="test-key",
        )
        db.add_all([character, book, profile])
        db.flush()
        db.add(models.GlobalWorldbookRegexConfig(id="default", worldbook_ids=[book.id], regex_rules=[]))
        chat_session = models.ChatSession(title="Regex Session", character_id=character.id, api_profile_id=profile.id)
        db.add(chat_session)
        db.commit()
        create_message(db, chat_session, parent_id=None, role="user", speaker="User", content="Entering the CITADEL")

        preview = build_context(db, chat_session)
        assert [item.id for item in preview.activated_lore] == ["good-entry"]
        regex_errors = [item for item in preview.diagnostics if item.code == "invalid_worldbook_regex"]
        assert len(regex_errors) == 1
        assert regex_errors[0].level == "error"
        assert "wb-regex-test" in regex_errors[0].message
        assert "bad-entry" in regex_errors[0].message
        assert "/[unclosed/i" in regex_errors[0].message
        assert "unterminated character set" in regex_errors[0].message
        session_id = chat_session.id

    gen_response = client.post(f"/api/sessions/{session_id}/generate/stream", json={})
    assert gen_response.status_code == 400
    detail = gen_response.json()["detail"]
    assert any(d["code"] == "invalid_worldbook_regex" for d in detail["diagnostics"])


def test_st_import_supports_utf8_bom_and_reports_json_line_column_and_png_details():
    bom_char = b"\xef\xbb\xbf" + json.dumps({"spec": "chara_card_v2", "data": {"name": "BOM Luna"}}).encode("utf-8")
    card = load_character_upload("bom_luna.json", bom_char)
    assert card.name == "BOM Luna"

    bom_book = b"\xef\xbb\xbf" + json.dumps({"name": "BOM World", "entries": {}}).encode("utf-8")
    book = load_worldbook_upload(bom_book, filename="bom_world.json")
    assert book.name == "BOM World"

    image = Image.new("RGB", (2, 2), "white")
    meta = PngImagePlugin.PngInfo()
    meta.add_text("chara", base64.b64encode(bom_char).decode("ascii"))
    buf = io.BytesIO()
    image.save(buf, format="PNG", pnginfo=meta)
    png_card = load_character_upload("bom_luna.png", buf.getvalue())
    assert png_card.name == "BOM Luna"

    broken_char_json = b'{\n  "name": "Luna",\n  broken_key\n}'
    with pytest.raises(HTTPException) as char_exc:
        load_character_upload("broken.json", broken_char_json)
    assert char_exc.value.status_code == 400
    assert "line 3" in char_exc.value.detail
    assert "column 3" in char_exc.value.detail

    broken_book_json = b'{\n  "entries": [\n    unquoted\n  ]\n}'
    with pytest.raises(HTTPException) as book_exc:
        load_worldbook_upload(broken_book_json, filename="broken_book.json")
    assert book_exc.value.status_code == 400
    assert "line 3" in book_exc.value.detail
    assert "column 5" in book_exc.value.detail

    with pytest.raises(HTTPException) as utf_exc:
        load_character_upload("latin1.json", b"\xff\xfe\x00")
    assert utf_exc.value.status_code == 400
    assert "UTF-8" in utf_exc.value.detail

    with pytest.raises(HTTPException) as png_exc:
        load_character_upload("corrupt.png", b"not-a-valid-png")
    assert png_exc.value.status_code == 400
    assert "Could not read PNG character card:" in png_exc.value.detail
    assert len(png_exc.value.detail) > len("Could not read PNG character card:")


@pytest.mark.asyncio
async def test_discover_models_custom_params_and_import_commit_preserve_sanitized_errors(monkeypatch, caplog):
    profile = models.APIProfile(
        name="Bad URL Profile",
        provider_type="openai_chat_completions",
        base_url="https://bad.example",
        model="gpt-4",
        api_key="sk-top-secret-key",
        custom_headers={"X-Custom-Auth": "hdr-secret-value"},
    )

    async def fail_invalid_url(_profile):
        raise httpx.InvalidURL("Invalid port 'abc' for key sk-top-secret-key and hdr-secret-value")

    monkeypatch.setattr(providers, "refresh_models", fail_invalid_url)
    refresh_out = await discover_profile_models(profile)
    assert refresh_out.available is False
    assert refresh_out.message is not None
    assert "InvalidURL" in refresh_out.message
    assert "Invalid port" in refresh_out.message
    assert "sk-top-secret-key" not in refresh_out.message
    assert "hdr-secret-value" not in refresh_out.message
    assert "[已隐藏密钥]" in refresh_out.message

    _body, _headers, _excluded, warnings = convert_custom_request_settings(
        {
            "custom_include_body": '{"prompt": "{{user}}"}',
            "custom_include_headers": "X-Dup: secret-one\nX-Dup: secret-two",
            "custom_exclude_body": "- block",
        }
    )
    assert any("macros are unsupported" in warning for warning in warnings)
    assert any("invalid or duplicate key" in warning for warning in warnings)
    assert "secret-one" not in " ".join(warnings)
    assert "secret-two" not in " ".join(warnings)

    client, _testing_session = _make_client()
    files = {
        "settings.json": json.dumps(
            {
                "username": "Ada",
                "main_api": "openai",
                "oai_settings": {
                    "chat_completion_source": "custom",
                    "custom_url": "https://live.test/v1",
                    "custom_model": "m",
                },
            }
        ).encode("utf-8"),
        "secrets.json": json.dumps(
            {"api_key_custom": [{"id": "k1", "label": "Key", "active": True, "value": "sk-import-plan-secret"}]}
        ).encode("utf-8"),
    }
    monkeypatch.setattr(
        "app.api.imports.read_source",
        lambda *a, **kw: (files, {"omitted": {}}, "ssh:test:/ST/data/default-user"),
    )
    preview = client.post("/api/imports/sillytavern/preview", json={"ssh_host": "test"})
    assert preview.status_code == 200
    token = preview.json()["token"]

    def failing_apply_plan(*args, **kwargs):
        raise OperationalError(
            "INSERT INTO saved_credentials VALUES (?)",
            {"api_key": "sk-import-plan-secret"},
            sqlite3.OperationalError("database is locked while saving sk-import-plan-secret"),
        )

    monkeypatch.setattr("app.api.imports.apply_plan", failing_apply_plan)
    with caplog.at_level(logging.ERROR, logger="app.api.imports"):
        apply_resp = client.post("/api/imports/sillytavern/apply", json={"token": token})
    assert apply_resp.status_code == 500
    assert "OperationalError" in apply_resp.json()["detail"]
    assert "database is locked" in apply_resp.json()["detail"]
    assert "sk-import-plan-secret" not in apply_resp.text
    assert any(record.exc_info is not None for record in caplog.records)


def test_produce_survives_transient_intermediate_operational_error_and_logs_unexpected_exceptions(monkeypatch, caplog):
    client, testing_session = _make_client()
    character = client.post("/api/characters", json={"name": "Apeiria", "first_mes": ""}).json()
    profile = client.post(
        "/api/api-profiles",
        json={
            "name": "Stream Profile",
            "provider_type": "openai_chat_completions",
            "base_url": "https://example.test",
            "model": "gpt-4",
            "api_key": "test-key",
        },
    ).json()
    chat_session = client.post(
        "/api/sessions",
        json={"title": "Stream Observability", "character_id": character["id"], "api_profile_id": profile["id"]},
    ).json()
    client.post(
        f"/api/sessions/{chat_session['id']}/messages",
        json={"role": "user", "speaker": "User", "content": "Hello"},
    )

    monkeypatch.setattr(generation_service, "COMMIT_INTERVAL", 0.0)

    async def three_chunk_stream(_profile, _context):
        yield providers.ProviderStreamEvent(kind="text", delta="Part 1 ")
        yield providers.ProviderStreamEvent(kind="text", delta="Part 2 ")
        yield providers.ProviderStreamEvent(kind="text", delta="Part 3")

    real_commit = Session.commit
    intermediate_failures = {"remaining": 1}

    def flaky_commit(self: Session) -> None:
        streaming_runs = [
            obj for obj in self.dirty if isinstance(obj, models.GenerationRun) and obj.status == "streaming"
        ]
        if streaming_runs and intermediate_failures["remaining"] > 0:
            intermediate_failures["remaining"] -= 1
            raise OperationalError(
                "UPDATE generation_runs SET ...",
                {},
                sqlite3.OperationalError("database is locked"),
            )
        real_commit(self)

    monkeypatch.setattr(providers, "stream_completion", three_chunk_stream)
    monkeypatch.setattr(Session, "commit", flaky_commit)

    with caplog.at_level(logging.WARNING, logger=generation_service.__name__):
        with client.stream("POST", f"/api/sessions/{chat_session['id']}/generate/stream", json={}) as resp:
            sse_body = "".join(resp.iter_text())

    assert "event: message_completed" in sse_body
    assert "Part 1 Part 2 Part 3" in sse_body
    assert intermediate_failures["remaining"] == 0
    assert any(
        record.levelno == logging.WARNING and "database is locked" in record.getMessage()
        for record in caplog.records
    )

    with testing_session() as db:
        first_run = db.scalars(select(models.GenerationRun)).one()
        first_msg = db.get(models.Message, first_run.output_message_id)
        assert first_run.status == "complete"
        assert first_msg is not None and first_msg.content == "Part 1 Part 2 Part 3"

    caplog.clear()

    def terminal_failing_commit(self: Session) -> None:
        complete_runs = [
            obj for obj in self.dirty if isinstance(obj, models.GenerationRun) and obj.status == "complete"
        ]
        if complete_runs:
            raise OperationalError(
                "UPDATE generation_runs SET status='complete' ...",
                {},
                sqlite3.OperationalError("disk I/O error on terminal commit"),
            )
        real_commit(self)

    monkeypatch.setattr(Session, "commit", terminal_failing_commit)
    with caplog.at_level(logging.ERROR, logger=generation_service.__name__):
        with client.stream("POST", f"/api/sessions/{chat_session['id']}/generate/stream", json={}) as resp:
            terminal_err_body = "".join(resp.iter_text())

    assert "event: error" in terminal_err_body
    assert "disk I/O error on terminal commit" in terminal_err_body
    assert any(record.levelno == logging.ERROR and record.exc_info is not None for record in caplog.records)

    monkeypatch.setattr(Session, "commit", real_commit)
    caplog.clear()

    async def unexpected_crash_stream(_profile, _context):
        yield providers.ProviderStreamEvent(kind="text", delta="Partial before crash")
        raise RuntimeError("unexpected serializer explosion")

    monkeypatch.setattr(providers, "stream_completion", unexpected_crash_stream)
    with caplog.at_level(logging.ERROR, logger=generation_service.__name__):
        with client.stream("POST", f"/api/sessions/{chat_session['id']}/generate/stream", json={}) as resp:
            crash_body = "".join(resp.iter_text())

    assert "event: error" in crash_body
    assert "unexpected serializer explosion" in crash_body
    assert any(
        record.levelno == logging.ERROR
        and record.exc_info is not None
        and "Generation run" in record.getMessage()
        for record in caplog.records
    )

    caplog.clear()

    async def business_error_stream(_profile, _context):
        raise ApplicationError(status_code=502, detail="upstream quota exceeded")
        yield ""  # pragma: no cover

    monkeypatch.setattr(providers, "stream_completion", business_error_stream)
    with caplog.at_level(logging.ERROR, logger=generation_service.__name__):
        with client.stream("POST", f"/api/sessions/{chat_session['id']}/generate/stream", json={}) as resp:
            app_err_body = "".join(resp.iter_text())

    assert "event: error" in app_err_body
    assert "upstream quota exceeded" in app_err_body
    assert caplog.records == []
