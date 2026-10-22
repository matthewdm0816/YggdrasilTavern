from copy import deepcopy

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import models
from app.database import Base
from app.services.prompt_builder import TTS_TAG_INSTRUCTION, build_context, compile_context, load_context_inputs
from app.services.prompt_config import default_prompt_slots
from app.services.token_counter import count_text_tokens


@pytest.mark.parametrize(
    'enabled,text_mode,instruct_model,expected',
    [(True, 'tags', True, True), (False, 'tags', True, False),
     (True, 'dialogue', True, False), (True, 'tags', False, False)],
)
def test_tts_instruction_requires_all_three_settings(enabled, text_mode, instruct_model, expected):
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        session = models.ChatSession(title='TTS prompt')
        db.add_all([session, models.TtsSettings(
            id='default', enabled=enabled, text_mode=text_mode, instruct_model=instruct_model,
        )])
        db.commit()
        context = build_context(db, session)
        tts_blocks = [block for block in context.compiled_blocks if block.source == 'tts.settings']
        assert bool(tts_blocks) is expected
        if expected:
            assert len(tts_blocks) == 1
            block = tts_blocks[0]
            assert block.role == 'system'
            assert block.content == TTS_TAG_INSTRUCTION
            assert block.token_count == count_text_tokens(TTS_TAG_INSTRUCTION)
            assert not block.is_history
            assert context.estimated_input_tokens == sum(item.token_count + 4 for item in context.compiled_blocks)
    engine.dispose()


def test_missing_tts_settings_does_not_create_settings_or_instruction():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        session = models.ChatSession(title='No TTS settings')
        db.add(session)
        db.commit()
        context = build_context(db, session)
        assert not any(block.source == 'tts.settings' for block in context.compiled_blocks)
        assert db.get(models.TtsSettings, 'default') is None
    engine.dispose()


def test_tts_compilation_keeps_saved_prompt_and_message_content_unchanged():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        slots = default_prompt_slots()
        slots[0]['content'] = 'User-authored system prompt.'
        expected_slots = deepcopy(slots)
        config = models.GlobalPromptConfig(id='default', prompt_slots=slots, revision=7)
        settings = models.TtsSettings(id='default', enabled=True, text_mode='tags', instruct_model=True)
        session = models.ChatSession(title='Stored prompt')
        db.add_all([config, settings, session])
        db.flush()
        message = models.Message(session_id=session.id, role='assistant', speaker='Luna', content='<tts>Stored dialogue.</tts>')
        db.add(message)
        db.commit()
        inputs = load_context_inputs(db, session, path_override=[message])
        settings.enabled = False
        db.commit()
        db.expire(config)
        assert config.prompt_slots == expected_slots
        assert config.revision == 7
        assert message.content == '<tts>Stored dialogue.</tts>'
        assert not any(slot.id == 'tts.tag_instruction' for slot in inputs.slots)
    engine.dispose()

    # The captured flag remains usable after DB shutdown and later settings edits.
    context = compile_context(inputs)
    block = context.compiled_blocks[-1]
    assert block.source == 'tts.settings'
    assert context.messages[-1].role == 'system'
    assert context.messages[-1].content == TTS_TAG_INSTRUCTION
    assert context.prompt_config_revision == 7
    assert next(item.content for item in context.compiled_blocks if item.is_history) == '<tts>Stored dialogue.</tts>'
