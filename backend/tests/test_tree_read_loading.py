from contextlib import contextmanager

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.database import Base, create_database_engine
from app.services.tree import active_path_ids, list_messages


@pytest.fixture
def engine():
    engine = create_database_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(models.ChatSession(id="session", title="Synthetic tree"))
        db.flush()
        db.add(models.Message(id="root", session_id="session", role="user", content="Question"))
        db.flush()
        db.add_all([
            models.Message(id="original", session_id="session", parent_id="root", role="assistant",
                           content="Original reply", sort_order=1),
            models.Message(id="partial", session_id="session", parent_id="root", role="assistant",
                           content="Partial reply", thinking_content="Partial reasoning", status="interrupted", sort_order=2),
        ])
        db.flush()
        db.add(models.Message(id="descendant", session_id="session", parent_id="original", role="user", content="Follow-up"))
        db.flush()
        db.get(models.ChatSession, "session").active_root_child_id = "root"
        db.get(models.Message, "root").selected_child_id = "partial"
        db.get(models.Message, "original").selected_child_id = "descendant"
        for message_id in ("original", "partial"):
            db.add(models.GenerationRun(
                id=f"run-{message_id}", session_id="session", output_message_id=message_id,
                provider_type="openai_chat_completions", model="synthetic-model",
                status="interrupted" if message_id == "partial" else "complete",
                prompt_snapshot={"content": f"prompt-{message_id}-" + "x" * 65536},
                prompt_hash="0" * 64,
            ))
        db.commit()
    yield engine
    engine.dispose()


@contextmanager
def capture_selects(engine):
    statements = []

    def record(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


def test_tree_response_skips_prompt_snapshots_and_preserves_all_branches(engine):
    with Session(engine) as db:
        expected = {
            message.id: schemas.MessageOut.model_validate(message).model_dump(mode="json")
            for message in db.scalars(select(models.Message).options(selectinload(models.Message.generation_run)))
        }
    with Session(engine) as db:
        session = db.get(models.ChatSession, "session")
        with capture_selects(engine) as statements:
            messages = list_messages(db, session.id)
            actual = {message.id: schemas.MessageOut.model_validate(message).model_dump(mode="json") for message in messages}
            selected_ids = active_path_ids(db, session)

        assert actual == expected
        assert selected_ids == ["root", "partial"]
        assert actual["original"]["selected_child_id"] == "descendant"
        assert actual["descendant"]["parent_id"] == "original"
        assert actual["partial"]["content"] == "Partial reply"
        assert actual["partial"]["thinking_content"] == "Partial reasoning"
        assert actual["partial"]["status"] == "interrupted"
        assert len(statements) == 2
        assert all("generation_runs.prompt_snapshot" not in statement for statement in statements)


def test_full_generation_record_remains_available_after_tree_load(engine):
    with Session(engine) as db:
        messages = list_messages(db, "session")
        run = next(message.generation_run for message in messages if message.id == "partial")
        detail = schemas.GenerationRunOut.model_validate(run)
        assert detail.prompt_snapshot == {"content": "prompt-partial-" + "x" * 65536}
        assert detail.status == "interrupted"
        assert detail.output_message_id == "partial"
