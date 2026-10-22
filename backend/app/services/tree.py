from __future__ import annotations

from collections import defaultdict, deque
from typing import List, Literal, Optional

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session, selectinload

from .. import models
from .errors import ApplicationError
from .token_counter import count_text_tokens


def get_session_or_404(db: Session, session_id: str) -> models.ChatSession:
    session = db.get(models.ChatSession, session_id)
    if not session:
        raise ApplicationError(status_code=404, detail="Session not found")
    return session


def get_message_or_404(db: Session, message_id: str) -> models.Message:
    message = db.get(models.Message, message_id)
    if not message:
        raise ApplicationError(status_code=404, detail="Message not found")
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
            raise ApplicationError(status_code=409, detail="Message tree contains a parent cycle")
        if current.session_id != message.session_id:
            raise ApplicationError(status_code=409, detail="Message parent belongs to another session")
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
        raise ApplicationError(status_code=409, detail="Selected message does not have a valid session root")
    session.active_root_child_id = root.id
    for parent, child in zip(path, path[1:]):
        if child.parent_id != parent.id or child.session_id != session.id:
            raise ApplicationError(status_code=409, detail="Selected message has an invalid ancestor chain")
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
            raise ApplicationError(status_code=400, detail="Parent message belongs to another session")

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


def prepare_tree_mutation(
    db: Session,
    session: models.ChatSession,
    *,
    busy_detail: str = "此会话正在生成消息，请先停止生成，再删除分支或切换消息角色",
) -> None:
    """Serialize SQLite writes before inspecting the tree and generation state."""
    db.execute(
        update(models.ChatSession)
        .where(models.ChatSession.id == session.id)
        .values(updated_at=models.ChatSession.updated_at)
    )
    db.refresh(session)
    running_message = db.scalar(
        select(models.Message.id).where(
            models.Message.session_id == session.id, models.Message.status == "streaming",
        ).limit(1)
    )
    running_generation = db.scalar(
        select(models.GenerationRun.id).where(
            models.GenerationRun.session_id == session.id, models.GenerationRun.status == "streaming",
        ).limit(1)
    )
    if running_message is not None or running_generation is not None:
        raise ApplicationError(status_code=409, detail=busy_detail)


def _tree_postorder(messages: List[models.Message]) -> tuple[list[models.Message], dict[Optional[str], list[models.Message]]]:
    """Order children before parents without recursion, including inactive roots."""
    by_id = {message.id: message for message in messages}
    children: dict[Optional[str], list[models.Message]] = defaultdict(list)
    for message in messages:
        if message.parent_id is not None and message.parent_id not in by_id:
            raise ApplicationError(status_code=409, detail="消息树包含缺失的父消息或跨会话连接，请先修复消息树")
        children[message.parent_id].append(message)
    remaining_children = {message.id: len(children[message.id]) for message in messages}
    pending = deque(message for message in messages if remaining_children[message.id] == 0)
    postorder: list[models.Message] = []
    while pending:
        message = pending.popleft()
        postorder.append(message)
        if message.parent_id is not None:
            remaining_children[message.parent_id] -= 1
            if remaining_children[message.parent_id] == 0:
                pending.append(by_id[message.parent_id])
    if len(postorder) != len(messages):
        raise ApplicationError(status_code=409, detail="消息树包含循环连接，请先修复消息树")
    return postorder, children


def _replacement_selection(
    selected_id: Optional[str], siblings: list[models.Message], deleted_ids: set[str],
) -> Optional[str]:
    if selected_id not in deleted_ids:
        return selected_id
    selected_index = next((index for index, message in enumerate(siblings) if message.id == selected_id), None)
    if selected_index is None:
        return next((message.id for message in siblings if message.id not in deleted_ids), None)
    # Prefer the previous swipe; when deleting the first swipe, select the next.
    candidates = [*reversed(siblings[:selected_index]), *siblings[selected_index + 1:]]
    return next((message.id for message in candidates if message.id not in deleted_ids), None)


def _delete_tree_messages(
    db: Session,
    session: models.ChatSession,
    postorder: list[models.Message],
    children: dict[Optional[str], list[models.Message]],
    deleted_ids: set[str],
) -> int:
    if not deleted_ids:
        return 0
    session.active_root_child_id = _replacement_selection(session.active_root_child_id, children[None], deleted_ids)
    for message in postorder:
        if message.id not in deleted_ids:
            message.selected_child_id = _replacement_selection(message.selected_child_id, children[message.id], deleted_ids)
    session.last_activity_at = models.utc_now()
    db.flush()
    ordered_ids = [message.id for message in postorder if message.id in deleted_ids]
    # Batches stay below SQLite's legacy parameter limit and retain child-first
    # order so Message.parent_id foreign keys remain valid after every batch.
    for offset in range(0, len(ordered_ids), 500):
        db.execute(delete(models.Message).where(models.Message.id.in_(ordered_ids[offset:offset + 500])))
    return len(deleted_ids)


def delete_message_branch(
    db: Session, message_id: str, *, scope: Literal["swipe", "layer"] = "swipe",
) -> tuple[models.ChatSession, int]:
    try:
        message = get_message_or_404(db, message_id)
        session = get_session_or_404(db, message.session_id)
        prepare_tree_mutation(db, session)
        message = db.get(models.Message, message_id, populate_existing=True)
        if message is None:
            raise ApplicationError(status_code=404, detail="Message not found")
        postorder, children = _tree_postorder(list_messages(db, session.id))
        roots = children[message.parent_id] if scope == "layer" else [message]
        deleted_ids: set[str] = set()
        pending = list(roots)
        while pending:
            current = pending.pop()
            if current.id in deleted_ids:
                continue
            deleted_ids.add(current.id)
            pending.extend(children[current.id])
        count = _delete_tree_messages(db, session, postorder, children, deleted_ids)
        db.commit()
        db.refresh(session)
        return session, count
    except Exception:
        db.rollback()
        raise


def prune_empty_branches(db: Session, session_id: str) -> tuple[models.ChatSession, int]:
    try:
        session = get_session_or_404(db, session_id)
        prepare_tree_mutation(db, session)
        postorder, children = _tree_postorder(list_messages(db, session.id))
        deleted_ids: set[str] = set()
        for message in postorder:
            if (not message.content.strip() and not message.thinking_content.strip()
                    and all(child.id in deleted_ids for child in children[message.id])):
                deleted_ids.add(message.id)
        count = _delete_tree_messages(db, session, postorder, children, deleted_ids)
        db.commit()
        db.refresh(session)
        return session, count
    except Exception:
        db.rollback()
        raise
