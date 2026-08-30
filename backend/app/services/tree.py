from __future__ import annotations

from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .. import models
from .token_counter import count_text_tokens


def get_session_or_404(db: Session, session_id: str) -> models.ChatSession:
    session = db.get(models.ChatSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


def get_message_or_404(db: Session, message_id: str) -> models.Message:
    message = db.get(models.Message, message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    return message


def list_messages(db: Session, session_id: str) -> List[models.Message]:
    return list(
        db.scalars(
            select(models.Message)
            .options(selectinload(models.Message.generation_run))
            .where(models.Message.session_id == session_id)
            .order_by(models.Message.parent_id.is_not(None), models.Message.sort_order, models.Message.created_at)
        )
    )


def siblings(db: Session, message: models.Message) -> List[models.Message]:
    stmt = (
        select(models.Message)
        .where(models.Message.session_id == message.session_id, models.Message.parent_id == message.parent_id)
        .order_by(models.Message.sort_order, models.Message.created_at)
    )
    if message.parent_id is None:
        stmt = (
            select(models.Message)
            .where(models.Message.session_id == message.session_id, models.Message.parent_id.is_(None))
            .order_by(models.Message.sort_order, models.Message.created_at)
        )
    return list(db.scalars(stmt))


def _next_sort_order(db: Session, session_id: str, parent_id: Optional[str]) -> int:
    stmt = select(func.max(models.Message.sort_order)).where(models.Message.session_id == session_id)
    if parent_id is None:
        stmt = stmt.where(models.Message.parent_id.is_(None))
    else:
        stmt = stmt.where(models.Message.parent_id == parent_id)
    max_order = db.scalar(stmt)
    return int(max_order or 0) + 1


def selected_child(db: Session, parent: models.Message) -> Optional[models.Message]:
    if not parent.selected_child_id:
        return None
    child = db.get(models.Message, parent.selected_child_id)
    if not child or child.parent_id != parent.id:
        return None
    return child


def active_path(db: Session, session: models.ChatSession) -> List[models.Message]:
    path: List[models.Message] = []
    current: Optional[models.Message] = None
    if session.active_root_child_id:
        root = db.get(models.Message, session.active_root_child_id)
        if root and root.session_id == session.id and root.parent_id is None:
            current = root

    if current is None:
        current = db.scalars(
            select(models.Message)
            .where(models.Message.session_id == session.id, models.Message.parent_id.is_(None))
            .order_by(models.Message.sort_order, models.Message.created_at)
        ).first()

    while current:
        path.append(current)
        current = selected_child(db, current)
    return path


def active_path_ids(db: Session, session: models.ChatSession) -> List[str]:
    return [message.id for message in active_path(db, session)]


def ancestor_path(
    db: Session,
    message: models.Message,
    *,
    include_self: bool = True,
) -> List[models.Message]:
    """Return the immutable parent chain from the root to ``message``.

    The tree may be loaded from an older database whose foreign-key checks were
    disabled, so fail loudly on a broken cross-session link or a cycle instead
    of silently compiling the wrong conversation history.
    """

    reverse_path: List[models.Message] = []
    current: Optional[models.Message] = message
    if not include_self:
        current = db.get(models.Message, message.parent_id) if message.parent_id else None
    seen: set[str] = set()
    while current is not None:
        if current.id in seen:
            raise HTTPException(status_code=409, detail="Message tree contains a parent cycle")
        if current.session_id != message.session_id:
            raise HTTPException(status_code=409, detail="Message parent belongs to another session")
        seen.add(current.id)
        reverse_path.append(current)
        current = db.get(models.Message, current.parent_id) if current.parent_id else None
    reverse_path.reverse()
    return reverse_path


def _select_path(db: Session, session: models.ChatSession, path: List[models.Message]) -> None:
    if not path:
        return
    root = path[0]
    if root.parent_id is not None or root.session_id != session.id:
        raise HTTPException(status_code=409, detail="Selected message does not have a valid session root")
    session.active_root_child_id = root.id
    for parent, child in zip(path, path[1:]):
        if child.parent_id != parent.id or child.session_id != session.id:
            raise HTTPException(status_code=409, detail="Selected message has an invalid ancestor chain")
        parent.selected_child_id = child.id


def select_message(db: Session, message: models.Message) -> models.ChatSession:
    session = get_session_or_404(db, message.session_id)
    _select_path(db, session, ancestor_path(db, message))
    session.last_activity_at = models.utc_now()
    db.commit()
    db.refresh(session)
    return session


def create_message(
    db: Session,
    session: models.ChatSession,
    *,
    parent_id: Optional[str],
    role: str,
    content: str,
    thinking_content: str = "",
    speaker: str = "",
    status: str = "complete",
    select_new: bool = True,
    model: str | None = None,
    commit: bool = True,
) -> models.Message:
    if parent_id:
        parent = get_message_or_404(db, parent_id)
        if parent.session_id != session.id:
            raise HTTPException(status_code=400, detail="Parent message belongs to another session")

    message = models.Message(
        session_id=session.id,
        parent_id=parent_id,
        role=role,
        content=content,
        thinking_content=thinking_content,
        speaker=speaker,
        status=status,
        token_count=count_text_tokens(content, model),
        thinking_token_count=count_text_tokens(thinking_content, model),
        sort_order=_next_sort_order(db, session.id, parent_id),
    )
    db.add(message)
    db.flush()
    if select_new:
        _select_path(db, session, ancestor_path(db, message))
    session.last_activity_at = models.utc_now()
    if commit:
        db.commit()
        db.refresh(message)
    else:
        db.flush()
    return message


def create_swipe(
    db: Session,
    base_message: models.Message,
    *,
    role: Optional[str],
    content: str,
    thinking_content: str = "",
    speaker: Optional[str],
    status: str = "complete",
    model: str | None = None,
) -> models.Message:
    session = get_session_or_404(db, base_message.session_id)
    return create_message(
        db,
        session,
        parent_id=base_message.parent_id,
        role=role or base_message.role,
        content=content,
        thinking_content=thinking_content,
        speaker=base_message.speaker if speaker is None else speaker,
        model=model,
        status=status,
        select_new=True,
    )


def last_active_message(db: Session, session: models.ChatSession) -> Optional[models.Message]:
    path = active_path(db, session)
    return path[-1] if path else None
