# Driving lightnovel-harness as a coding agent

This harness exists so that the model writing prose never shares a context with
tool calls, code or JSON. When you (a coding agent) drive it, keep it that way.

## Rules

- Never write or rewrite novel prose yourself, not even "small fixes" to a draft.
  Prose only comes from `lnh draft`, `lnh write` or `lnh revise`. If a scene needs
  changes, pass them as `lnh revise <v> <c> <s> --notes "..."`.
- You may edit planning files (`bible.yaml`, `plan/*.yaml`) and `style.md`.
  Run `uv run lnh -p <project> check` after every edit and fix all errors before
  drafting. `lnh draft` refuses plans with errors.
- Work in story order: plan chapter N only after chapter N-1 is drafted and
  digested, so the beat sheet follows what was actually written.
- Do not change `premise.md` unless the author asks; it is their voice.
- Before changing anything in `packet.py` or `prompts/writer_*.md`, run
  `uv run lnh -p <project> packet <v> <c> <s>` and read what the writer sees.
  Nothing structural (ids, JSON, tool names, pipeline vocabulary) or spoiling
  (secrets, unrevealed answers, future chapters) may appear there.
  `tests/test_packet.py` guards this.
- The API key lives in `.env`; never print it or commit it.

## Commands

All commands: `uv run lnh -p <project dir> <command>`; `uv run lnh --help` lists them.
Tests: `uv run pytest`.
