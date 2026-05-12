from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import ChatSession
from app.services.tree import active_path, create_message, create_swipe, select_message


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
