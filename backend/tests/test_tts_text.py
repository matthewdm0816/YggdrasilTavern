import pytest

from app.services.tts_text import extract_tts_text


def test_tags_read_only_complete_blocks_in_source_order():
    result = extract_tts_text('旁白。<tts>你好。</tts>她坐下。<tts>再见。</tts>', 'tags')
    assert result.segments == ['你好。', '再见。']
    assert result.text == '你好。\n再见。'
    assert result.warnings == []


@pytest.mark.parametrize('content', ['只有旁白。', '“普通引号”', '<tts voice="x">不要读</tts>', '<tts-extra>不要读</tts-extra>'])
def test_tags_do_not_fallback_or_accept_attributes(content):
    result = extract_tts_text(content, 'tags')
    assert result.text == ''
    assert result.segments == []
    assert result.warnings


def test_tags_are_case_insensitive_and_keep_intentional_repetition():
    result = extract_tts_text('<TTS>你好</TTS><tts>你好</tts>', 'tags')
    assert result.segments == ['你好', '你好']


def test_tags_preserve_complete_block_before_unclosed_block():
    result = extract_tts_text('<tts>完成</tts><tts>没有完成', 'tags')
    assert result.segments == ['完成']
    assert any('未闭合的 <tts>' in warning for warning in result.warnings)


def test_nested_tags_form_one_segment_without_duplication():
    result = extract_tts_text('<tts>外层 <tts>内层</tts> 结束</tts>', 'tags')
    assert result.segments == ['外层 内层 结束']
    assert any('嵌套' in warning for warning in result.warnings)


def test_tags_remove_formatting_but_keep_minimax_cues_and_written_words():
    result = extract_tts_text('<tts><b>你好</b> (laughs) <#0.5#> **欢迎** (sighs) voice_id &amp; [链接](https://example.com) ![图](x)</tts>', 'tags')
    assert result.text == '你好 (laughs) <#0.5#> 欢迎 (sighs) voice_id & 链接'


@pytest.mark.parametrize('mode,spoken', [('tags', '<tts>可以读</tts>'), ('dialogue', '“可以读”')])
@pytest.mark.parametrize('tag', ['think', 'analysis', 'reasoning', 'script', 'style'])
def test_hidden_blocks_exclude_fake_tags_and_quotes(mode, spoken, tag):
    content = f'<{tag} data-note="x > y"><tts>秘密</tts>“秘密”</{tag}>{spoken}'
    result = extract_tts_text(content, mode)
    assert result.segments == ['可以读']


def test_nested_hidden_blocks_do_not_leak_inner_quotes():
    result = extract_tts_text('<THINK>“秘密”<analysis>“里面”</analysis>“外面”</THINK>“可读”', 'dialogue')
    assert result.text == '可读'


@pytest.mark.parametrize('hidden', ['<think>', '<analysis x="1">', '<reasoning', '<script><style></script>'])
def test_unclosed_hidden_block_suppresses_remainder(hidden):
    result = extract_tts_text('“可读”' + hidden + '“秘密”<tts>秘密</tts>', 'dialogue')
    assert result.text == '可读'
    assert any('未闭合的思考' in warning for warning in result.warnings)


def test_comments_cannot_add_dialogue_or_tts_tags():
    content = '<!-- <tts>秘密</tts> “秘密” --><tts>可读</tts>“对白”'
    assert extract_tts_text(content, 'tags').text == '可读'
    assert extract_tts_text(content, 'dialogue').text == '对白'


def test_unclosed_comment_suppresses_remainder():
    result = extract_tts_text('<tts>可读</tts><!-- <tts>秘密</tts>', 'tags')
    assert result.text == '可读'
    assert any('HTML 注释' in warning for warning in result.warnings)


@pytest.mark.parametrize('fence', ['```', '~~~~'])
def test_fenced_code_excludes_quotes_and_tts_tags(fence):
    content = f'{fence}python\n"秘密" <tts>秘密</tts>\n{fence}\n“可读”<tts>可读</tts>'
    assert extract_tts_text(content, 'tags').text == '可读'
    assert extract_tts_text(content, 'dialogue').text == '可读'


def test_inline_code_delimiter_length_and_escaped_backticks():
    result = extract_tts_text('`` ` “秘密” `` “可读 \\`文字\\`”', 'dialogue')
    assert result.text == '可读 `文字`'


@pytest.mark.parametrize('unfinished', ['\n```python\n', '`', '\n~~~\n'])
def test_unclosed_code_suppresses_remainder(unfinished):
    result = extract_tts_text('<tts>可读</tts>' + unfinished + '<tts>秘密</tts>', 'tags')
    assert result.text == '可读'
    assert any('未闭合' in warning for warning in result.warnings)


def test_dialogue_supports_chinese_english_japanese_and_french():
    result = extract_tts_text('她说：“你好。” Then: "Hello!" 次に「こんにちは」。『またね』。«Salut»。＂再见＂', 'dialogue')
    assert result.segments == ['你好。', 'Hello!', 'こんにちは', 'またね', 'Salut', '再见']


def test_dialogue_preserves_nested_content_without_duplicate_segments():
    result = extract_tts_text('“她说「这是『内层』」。”', 'dialogue')
    assert result.segments == ['她说「这是『内层』」。']


def test_dialogue_respects_escaped_quotes_and_apostrophes():
    result = extract_tts_text(r'''"I said \"hello\". Don't worry; I’m here."''', 'dialogue')
    assert result.segments == ['I said "hello". Don\'t worry; I’m here.']


@pytest.mark.parametrize('content', ['她坐在窗边。', "Don't say anything.", "'a quoted identifier'", '只有“未闭合', '“ ”'])
def test_dialogue_returns_no_narration_fallback(content):
    result = extract_tts_text(content, 'dialogue')
    assert result.text == ''
    assert result.segments == []
    assert result.warnings


def test_dialogue_ignores_action_quotes_and_keeps_bold_dialogue():
    result = extract_tts_text('*她轻声哼出“秘密”* **“可读”**。"Hello *she smiles* again."', 'dialogue')
    assert result.segments == ['可读', 'Hello again.']


def test_dialogue_skips_unclosed_action():
    result = extract_tts_text('“可读” *她想着“秘密”', 'dialogue')
    assert result.text == '可读'
    assert any('星号动作' in warning for warning in result.warnings)


def test_dialogue_skips_html_attributes_and_image_descriptions():
    result = extract_tts_text('<span title="秘密">“可读”</span> ![“图注”](image.png)', 'dialogue')
    assert result.text == '可读'


def test_dialogue_allows_line_breaks_and_recovers_after_unclosed_paragraph():
    result = extract_tts_text('“第一行\n第二行”\n\n「未闭合\n\n“另一个段落”', 'dialogue')
    assert result.segments == ['第一行 第二行', '另一个段落']
    assert any('未闭合的引号' in warning for warning in result.warnings)


def test_empty_result_has_a_single_human_readable_warning():
    result = extract_tts_text('', 'tags')
    assert result.text == ''
    assert len(result.warnings) == 1


def test_invalid_mode_fails_loudly():
    with pytest.raises(ValueError, match='Unsupported TTS extraction mode'):
        extract_tts_text('hello', 'invalid')
