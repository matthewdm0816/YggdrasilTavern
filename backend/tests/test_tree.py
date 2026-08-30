from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import ChatSession
from app.services.tree import active_path, ancestor_path, create_message, create_swipe, select_message


def make_db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)()


def test_swipe_selection_recomputes_descendant_context():
    db = make_db()
    session = ChatSession(title="branch test", preset={})
    db.add(session)
    db.commit()
    db.refresh(session)

    greeting = create_message(db, session, parent_id=None, role="assistant", speaker="A", content="hello")
    first_user = create_message(db, session, parent_id=greeting.id, role="user", speaker="User", content="go left")
    first_assistant = create_message(db, session, parent_id=first_user.id, role="assistant", speaker="A", content="left path")

    second_user = create_swipe(db, first_user, role="user", speaker="User", content="go right")
    create_message(db, session, parent_id=second_user.id, role="assistant", speaker="A", content="right path")

    select_message(db, first_user)
    assert [message.content for message in active_path(db, session)] == ["hello", "go left", "left path"]

    select_message(db, second_user)
    assert [message.content for message in active_path(db, session)] == ["hello", "go right", "right path"]
    assert first_assistant.content not in [message.content for message in active_path(db, session)]


def test_selecting_deep_inactive_node_updates_every_ancestor_selection():
    db = make_db()
    session = ChatSession(title="deep branch test", preset={})
    db.add(session)
    db.commit()

    greeting = create_message(db, session, parent_id=None, role="assistant", content="hello")
    left_user = create_message(db, session, parent_id=greeting.id, role="user", content="left")
    left_assistant = create_message(db, session, parent_id=left_user.id, role="assistant", content="left answer")
    left_tail = create_message(db, session, parent_id=left_assistant.id, role="user", content="left tail")

    right_user = create_swipe(db, left_user, role="user", speaker="User", content="right")
    right_assistant = create_message(db, session, parent_id=right_user.id, role="assistant", content="right answer")
    assert [message.content for message in active_path(db, session)] == ["hello", "right", "right answer"]

    assert [message.id for message in ancestor_path(db, left_tail)] == [
        greeting.id,
        left_user.id,
        left_assistant.id,
        left_tail.id,
    ]
    select_message(db, left_tail)

    db.refresh(session)
    db.refresh(greeting)
    db.refresh(left_user)
    db.refresh(left_assistant)
    assert session.active_root_child_id == greeting.id
    assert greeting.selected_child_id == left_user.id
    assert left_user.selected_child_id == left_assistant.id
    assert left_assistant.selected_child_id == left_tail.id
    assert [message.content for message in active_path(db, session)] == ["hello", "left", "left answer", "left tail"]
