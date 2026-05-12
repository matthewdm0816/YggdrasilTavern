# TreeChat

TreeChat is a local-first roleplay webchat with SillyTavern-style character/worldbook imports and tree-shaped chat sessions. Each message can have sibling swipes; selecting a different swipe changes the active path and therefore the downstream prompt context.

## Stack

- Backend: FastAPI, SQLAlchemy, Alembic, SQLite, httpx, Pillow.
- Frontend: React, Vite, TypeScript, TanStack Query, Zustand, lucide-react.
- Providers: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses.

## Quick Start

Double-click `start.bat`, or run:

```powershell
cd path\to\treechat
.\scripts\start.ps1
```

Then open `http://127.0.0.1:5173`.

To stop both dev servers, double-click `stop.bat`, or run:

```powershell
.\scripts\stop.ps1
```

Manual startup:

```powershell
cd path\to\treechat
. .\scripts\uv-env.ps1
uv sync --python 3.12
Copy-Item backend\.env.example backend\.env
uv run uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

In another terminal:

```powershell
cd path\to\treechat\frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## API Keys

API keys are never stored in SQLite. Create an API Profile in the UI and set `api_key_env` to an environment variable name such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, then put the real key in `backend\.env` or your shell environment.

## Tree Model

- Root messages are siblings under the session root.
- Swipes are sibling messages with the same `parent_id`.
- The session stores `active_root_child_id`.
- Every message stores `selected_child_id`.
- Active context starts at the active root child and follows `selected_child_id` until no selected child exists.

## Compatibility Notes

- Character import supports Character Card V1/V2 JSON and PNG cards with `chara` or `ccv3` metadata.
- Worldbook import accepts common SillyTavern-style `entries` maps/lists, `key`, `keysecondary`, `constant`, `selective`, `disable`, order and depth fields.
- Chub.ai import accepts public Chub URLs or paths such as `characters/user/slug` and `lorebooks/user/slug`.
- Assistant messages record estimated content tokens, thinking tokens, cached tokens when providers report them, and raw usage metadata.
- Streaming thinking is shown expanded while generation is in progress and collapses when the message completes.
- Per-session system prompts are editable from the right inspector panel.
- v1 is text-only streaming. Tool calls, multimodal input, STscript, group chat, and full recursive world-info behavior are intentionally out of scope.

## Useful Commands

```powershell
cd path\to\treechat
. .\scripts\uv-env.ps1
uv run pytest
uv run alembic -c backend\alembic.ini upgrade head

cd frontend
npm run build
npm test
```
