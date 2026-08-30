# YggdrasilTavern

**English** · [简体中文](README.zh-CN.md)

YggdrasilTavern is a local-first role-play chat workbench built around a real conversation tree. Branches are not visual copies of a linear transcript: every swipe, edit, regeneration, and alternate greeting is a persistent sibling node, and only the currently selected path is compiled into the next model request.

The current milestone is a single-user local web application. It combines a FastAPI/SQLite backend with a responsive React interface and supports common SillyTavern character and worldbook formats without attempting to clone SillyTavern wholesale.

## Why a real tree?

```text
Session root
├─ First greeting (selected)
│  └─ User message
│     ├─ Assistant swipe A
│     └─ Assistant swipe B (selected)
│        └─ Next user message
└─ Alternate greeting
```

- Root greetings are sibling nodes under the session root.
- Messages with the same `parent_id` are sibling swipes.
- A session stores its selected root, and every message can point to one selected child.
- The active context follows those selections from the root to the current leaf.
- Switching a swipe or selecting a node in the branch map changes the downstream prompt path.
- Editing, copying, or regenerating creates a new sibling; it does not overwrite the original message or its descendants.
- Interrupted and cancelled generations keep their partial assistant message instead of silently deleting it.

This tree model is the core invariant of the project.

## Features

### Sessions and chat

- Independent sessions with their own character, API Profile/model, selected tree path, Regex rules, and worldbook bindings.
- Session title search, folders, pinning, archiving, and archived-session view.
- Markdown and GitHub-Flavored Markdown rendering.
- Streaming answer text, streaming thinking, stop, continue, and regenerate controls.
- Swipe navigation, branch map navigation, copy-as-swipe, and edit-as-swipe.
- A pop-up Tree View renders the complete conversation forest: hover or focus previews a swipe, the first click pins it, and the second click jumps to that node and branch.
- `first_mes` and `alternate_greetings` become root-level swipes; the first valid greeting is selected by default.
- Message telemetry for input, output, cached-input, and thinking tokens when available, plus generation speed.

### Global composable Prompt Profile

Prompt structure is global across all sessions. The default slots are:

1. Main Prompt
2. World Info Before
3. Character Description
4. Character Personality
5. Scenario
6. Example Dialogue
7. Pre-History Instruction
8. Chat History
9. World Info After
10. Post-History Instruction

Slots can be enabled or disabled, reordered by drag-and-drop or arrow controls, assigned a `system`, `user`, or `assistant` role, and given a global text override. Custom slots can be added and removed. The History slot always inserts the active tree path.

The global configuration is revisioned, so a stale browser window cannot silently overwrite a newer Prompt Profile. The Inspector also shows the final provider-neutral System/Messages payload and activated lore before generation.

Global structure does not remove session independence:

| Shared globally | Kept per session |
| --- | --- |
| Slot order, names, roles, enabled state | Character and character fields |
| Custom slots | Selected tree/history path |
| Explicit slot overrides | API Profile and model binding |
| Prompt configuration revision | Regex rules and worldbook selection |
|  | User name and greeting behavior |

Each generation stores the compiled Prompt snapshot, Prompt hash, model, parameters, timing, usage, and terminal status, so older replies retain the configuration that produced them.

### API Profiles and providers

Supported provider protocols:

- OpenAI Responses API
- OpenAI-compatible Chat Completions
- Anthropic Messages API

An API Profile contains a name, protocol, Base URL, optional path override, model ID, API Key, and default parameters such as temperature. Profiles are shared mutable references: changing a Profile immediately affects every session bound to it, while different sessions may bind different Profiles and models.

Remote model discovery is available when the provider implements a compatible `/v1/models` endpoint. Manual model IDs remain supported when it does not.

### Character cards and avatars

- Import Character Card V1/V2 JSON.
- Import PNG cards containing `chara` or `ccv3` metadata.
- Import public Chub.ai characters from a URL or `characters/user/slug` path.
- Create, edit, delete, and export local characters as normalized V2 JSON.
- Edit description, personality, scenario, first message, example dialogue, character System Prompt, Post-History Instruction, creator notes, tags, and alternate greetings.
- Upload a PNG/JPEG/WebP avatar, crop by zoom and offset, rotate in 90-degree steps, and flip horizontally or vertically.
- Preserve the original avatar alongside the derived WebP preview and transform metadata, allowing later re-editing.

PNG card export is not currently provided.

### Worldbooks

- Import and export common SillyTavern-style worldbook JSON.
- Import public Chub.ai lorebooks from a URL or `lorebooks/user/slug` path.
- Bind multiple worldbooks to one session.
- Create and edit entries with primary/secondary keys, constant/selective activation, case sensitivity, whole-word matching, order, content, and before/after-character placement.
- Configure recent-message scan depth and an activated-lore token budget per book.
- Preserve unknown imported fields where possible when exporting.

Lore activation scans the currently selected tree path. Full SillyTavern recursive World Info behavior and every insertion-depth semantic are not implemented yet.

### Regex display and Prompt transformations

Regex rules are currently session-scoped and support four targets:

- Chat display
- User messages
- Assistant messages
- Outgoing Prompt text

Two modes are available:

- **Explicit replacement** displays or sends the replaced text.
- **Veil** visually covers the affected paragraph until hover, click, Enter, or Space reveals it.

The original `Message.content` is never rewritten. Outgoing Prompt rules only support explicit replacement. The UI exposes `g`, `i`, `m`, and `s` as readable matching options rather than raw flag letters.

Browser-side display rules use JavaScript `RegExp`; server-side outgoing rules use a portable subset implemented by Python `re`. Prefer syntax supported by both engines when one rule must behave consistently in both places.

### Responsive interface

- Three-column desktop workspace with independently collapsible side panels.
- Every section in both side panels can be collapsed independently, and its state is remembered locally.
- Compact layout for narrower desktop windows.
- Dedicated mobile layout at 920 px and below, with resource and Inspector drawers.
- 44 px minimum primary touch targets on coarse-pointer devices.
- Safe-area-aware mobile composer and full-screen mobile resource editors.
- Light, dark, and follow-system themes persisted in browser storage.

The interface is responsive web UI, not a native mobile application or installable offline PWA.

## Quick start on Windows

### Requirements

- Windows PowerShell
- [uv](https://docs.astral.sh/uv/)
- Node.js and npm
- Python `>=3.12,<3.14` (`uv` can provision Python 3.12)

Clone the repository and start both development servers:

```powershell
git clone https://github.com/matthewdm0816/YggdrasilTavern.git
cd YggdrasilTavern
.\start.bat
```

You can also run the PowerShell script directly:

```powershell
.\scripts\start.ps1
```

The script:

- creates `backend\.env` from the example file when missing;
- syncs the Python environment with `uv`;
- installs frontend packages when `node_modules` is missing;
- starts the backend on `127.0.0.1:8000` and the frontend on `127.0.0.1:5173`;
- writes `backend\server.log` and `frontend\dev.log`;
- opens the frontend in the default browser.

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) if it does not open automatically. FastAPI documentation is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

Stop both servers with:

```powershell
.\stop.bat
```

or:

```powershell
.\scripts\stop.ps1
```

The stop script terminates processes listening on the configured backend and frontend ports. Pass matching port arguments if you deliberately changed them.

### Manual development startup

Backend, from the repository root:

```powershell
. .\scripts\uv-env.ps1
uv sync --python 3.12
Copy-Item backend\.env.example backend\.env -ErrorAction SilentlyContinue
uv run uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

Frontend, in a second terminal:

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

The Vite development server proxies `/api` to `http://127.0.0.1:8000` by default.

## First-use workflow

1. Open **API Profiles** and create a Profile with the provider protocol, Base URL, model ID, and API Key.
2. Optionally refresh the remote model list, or keep the manually entered model ID.
3. Import or create a character, then edit its fields and avatar if needed.
4. Import or create any worldbooks and edit their entries.
5. Create a session and bind its character, API Profile, worldbooks, and optional folder.
6. Chat normally; use swipe controls or the branch map to move through the real tree.
7. Use the Inspector to edit the global Prompt Profile, configure session Regex/worldbooks, and inspect the final compiled Prompt.

Profile changes take effect on the next request; no application restart is required.

## Data and security

- The default database is `treechat.db` in the repository root when started with the provided scripts.
- Startup automatically runs the Alembic migration chain before serving requests.
- SQLite foreign keys, WAL mode, and a busy timeout are enabled.
- Directly entered API Keys are stored **unencrypted** in the local SQLite database.
- Profile read responses expose only `has_api_key`; they never return the stored Key.
- Keys are not included in Prompt snapshots, Generation Runs, message history, or frontend browser storage.
- The API removes submitted input values from validation errors and does not relay raw provider error bodies.
- Leading and trailing whitespace is removed from API Key input in both the UI and backend.
- `.env`, databases, WAL/SHM files, logs, dependencies, and build output are excluded by `.gitignore`.

For legacy/API-only Profiles, `api_key_env` can reference a variable already present in the backend process environment; a directly stored Key takes precedence. Do not assume arbitrary provider keys written to `backend\.env` are exported into the process environment.

The supplied servers bind to loopback and have no application-level authentication. Do not expose them directly to a LAN or the public Internet without adding authentication, TLS, and an appropriate secret-storage strategy.

Provider generation, remote model discovery, and Chub imports make outbound network requests.

## Testing and migrations

Backend:

```powershell
. .\scripts\uv-env.ps1
uv run pytest
uv run alembic -c backend\alembic.ini upgrade head
```

Frontend:

```powershell
cd frontend
npm test
npm run build
```

## Project layout

```text
backend/
  alembic/                 Database migrations
  app/api/                 FastAPI routes
  app/services/            Tree, Prompt, provider, import, and token services
  tests/                   Backend and migration tests
frontend/
  src/components/          Chat workspace, Inspector, resource editors, renderers
  src/lib/                 API client, tree, Prompt, and Regex helpers
  src/state/               Per-session UI state
scripts/                   Windows start/stop and uv environment scripts
treechat.db                Local database created at runtime; ignored by Git
```

## Current boundaries

- Text streaming only; no multimodal input.
- No tool calling.
- No STscript.
- No group chat.
- No complete SillyTavern recursive World Info implementation.
- Character/worldbook import targets common real-world formats, not every edge of every specification revision.
- Token counts are estimated when a provider does not report complete usage.
- Local single-user operation only; this is not a hardened multi-user deployment.
- The current application UI is primarily Simplified Chinese; the English README does not imply full UI internationalization.
