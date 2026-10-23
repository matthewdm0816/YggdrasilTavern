from contextlib import contextmanager

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from app import models
from app.database import Base, create_database_engine
from app.services import prompt_builder


@pytest.fixture
def engine():
    engine = create_database_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(models.ChatSession(id="session", title="Synthetic worldbooks"))
        db.commit()
    yield engine
    engine.dispose()


@contextmanager
def capture_worldbook_selects(engine):
    statements = []

    def record(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT") and (
            "FROM worldbooks" in statement or "FROM worldbook_entries" in statement
        ):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


@pytest.mark.parametrize("book_count", [0, 1, 8, 32])
def test_worldbook_queries_stay_bounded_as_selection_grows(engine, book_count):
    selected_ids = [f"book-{index}" for index in reversed(range(book_count))]
    with Session(engine) as db:
        db.add(models.GlobalWorldbookRegexConfig(id="default", worldbook_ids=selected_ids, regex_rules=[]))
        for book_id in selected_ids:
            db.add(models.WorldBook(id=book_id, name=book_id, entries=[
                models.WorldBookEntry(id=f"entry-{book_id}", content=book_id, constant=True),
            ]))
        db.commit()

    with Session(engine) as db:
        session = db.get(models.ChatSession, "session")
        with capture_worldbook_selects(engine) as statements:
            inputs = prompt_builder.load_context_inputs(db, session, path_override=[])
        assert [book.id for book in inputs.worldbooks] == selected_ids
        assert [book.candidates[0].content for book in inputs.worldbooks] == selected_ids
        assert len(statements) == (2 if book_count else 0)


def test_worldbook_loading_keeps_order_missing_diagnostics_and_disabled_entries(engine, monkeypatch):
    with Session(engine) as db:
        db.add(models.GlobalWorldbookRegexConfig(
            id="default", worldbook_ids=["book-b", "missing", "book-a", "book-b", "missing"], regex_rules=[],
        ))
        for book_id in ("book-a", "book-b", "unselected"):
            db.add(models.WorldBook(id=book_id, name=book_id, entries=[
                models.WorldBookEntry(id=f"later-{book_id}", content=f"Later {book_id}", constant=True, order=20),
                models.WorldBookEntry(id=f"disabled-{book_id}", content=f"Disabled {book_id}", constant=True,
                                      enabled=False, order=5),
                models.WorldBookEntry(id=f"first-{book_id}", content=f"First {book_id}", constant=True, order=10),
            ]))
        db.commit()

    # Keep this loader regression independent of tokenizer caches and network access.
    monkeypatch.setattr(prompt_builder, "count_text_tokens", lambda content, model=None: len(content))
    with Session(engine) as db:
        session = db.get(models.ChatSession, "session")
        with capture_worldbook_selects(engine) as statements:
            inputs = prompt_builder.load_context_inputs(db, session, path_override=[])
            context = prompt_builder.compile_context(inputs)

        assert inputs.worldbook_ids == ("book-b", "missing", "book-a")
        assert [book.id for book in inputs.worldbooks] == ["book-b", "book-a"]
        assert [[entry.id for entry in book.candidates] for book in inputs.worldbooks] == [
            ["disabled-book-b", "first-book-b", "later-book-b"],
            ["disabled-book-a", "first-book-a", "later-book-a"],
        ]
        assert all(not book.candidates[0].enabled for book in inputs.worldbooks)
        assert context.worldbook_ids == ["book-b", "book-a"]
        assert [entry.id for entry in context.activated_lore] == [
            "first-book-a", "first-book-b", "later-book-a", "later-book-b",
        ]
        errors = [diagnostic for diagnostic in context.diagnostics if diagnostic.code == "missing_worldbook"]
        assert len(errors) == 1
        assert errors[0].message == "Worldbook 'missing' does not exist"
        assert len(statements) == 2
