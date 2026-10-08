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

- Independent sessions with their own character, selected tree path, Regex rules, and worldbook bindings. Creating a chat requires a character; when its title is blank, the character name is used automatically.
- The active API Profile is a browser-local global selection, not a Profile permanently bound to the current chat session.
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
| Explicit slot overrides | User name and greeting behavior |
| Prompt configuration revision | Regex rules and worldbook selection |

Each generation stores the compiled Prompt snapshot, Prompt hash, model, parameters, timing, usage, and terminal status, so older replies retain the configuration that produced them.

### API Profiles and providers

Supported provider protocols:

- OpenAI Responses API
- OpenAI-compatible Chat Completions
- Anthropic Messages API

An API Profile contains a name, protocol, Base URL, optional path override, model ID, API Key, and default parameters such as temperature. The selected Profile is a browser-local global choice and is applied when generation starts; it is not persisted as a fixed chat-session setting. Each generation still records the model and request parameters actually used in its run metadata.

Profiles default to a 256K-token input limit and a 32K-token output limit. Both are editable. When the selected model reports a smaller capability, YggdrasilTavern uses the smaller effective value. If the compiled Prompt exceeds the effective input limit, only the oldest complete messages from the currently selected tree path are removed; fixed Prompt blocks and the newest two history messages are preserved, and an impossible fit is reported as an error rather than silently cutting a message.

Remote model discovery is available when the provider implements a compatible `/v1/models` endpoint. Manual model IDs remain supported when it does not.

Capability discovery is provider-dependent: Anthropic can report separate input/output limits, Kimi can report a shared total context window, while OpenAI's standard `/v1/models` response exposes model identity but not context limits. Unknown values remain unknown and can be configured manually in the Profile.

Thinking Level is translated to the appropriate provider parameter for OpenAI Responses, OpenAI-compatible Chat Completions, or Anthropic Messages. If the selected remote model does not support that setting, the provider error is surfaced explicitly instead of silently changing the request.

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

The launcher records process IDs, start times, and executable paths in `.yggdrasil-runtime/`. The stop script verifies those records before stopping the recorded launchers and their children. Missing or stale records are reported without stopping other processes. Pass matching port arguments if you changed them. Manage manually started services and services from older launchers through their original process controls.

### LAN access and HTTPS

The default command remains loopback-only. To make the UI reachable from other devices on the same LAN, pass `-Lan` through the batch launcher:

```powershell
.\start.bat -Lan
```

LAN mode asks interactively for a username and a password of at least 12 characters. The password and a newly generated 32-byte session-signing secret are passed only through the backend child process environment; they are not placed in the process command line, log files, or `backend\.env`. Restarting LAN mode generates a new signing secret and invalidates existing login sessions.

Only Vite binds to `0.0.0.0`. Uvicorn remains on `127.0.0.1`, so LAN clients cannot bypass authentication by connecting directly to the backend port; browser `/api` traffic goes through Vite's loopback proxy and is authenticated by the backend. Stop existing servers before switching into or out of LAN/HTTPS mode so the script can verify that both configured ports are clean.

For HTTPS, provide a PEM certificate and its PEM private key. HTTPS terminates at Vite; the proxy hop to Uvicorn stays HTTP on loopback:

```powershell
.\start.bat -Lan `
  -HttpsCertificate "C:\certs\Yggdrasil LAN\yggdrasil-cert.pem" `
  -HttpsPrivateKey "C:\certs\Yggdrasil LAN\yggdrasil-key.pem"
```

The same certificate options can be used without `-Lan` for local HTTPS. In authenticated HTTPS mode the script also enables the cookie's `Secure` flag. The startup script passes the matching backend origin to Vite, so its `/api` proxy uses the backend's actual `http://127.0.0.1:<port>` scheme rather than a hard-coded target.

For a self-signed or private-CA certificate:

- Put every name clients will use in the certificate's Subject Alternative Name (SAN), typically `localhost`, `127.0.0.1`, the computer's LAN IP, and any LAN DNS name. A matching Common Name alone is not sufficient in modern browsers.
- Trust the issuing CA or certificate on every client device and verify its fingerprint through a separate trusted channel. Trusting it on the server computer does not automatically trust it on phones or other PCs.
- Keep the private key outside the repository and restrict access to it. Never commit it.

Plain HTTP LAN mode provides authentication but no transport encryption. The password, signed session cookie, prompts, and responses can be observed or modified by someone with access to the network. Use it only on an isolated trusted LAN; prefer HTTPS, restrict the frontend port with the host firewall, and never expose this development server directly to the public Internet.

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
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

The Vite development server proxies `/api` to `http://127.0.0.1:8000` by default. `scripts/start.ps1` supplies an explicit `YGGDRASIL_BACKEND_ORIGIN` when it launches Vite and supplies the certificate/key paths when HTTPS is enabled.

## First-use workflow

1. Open **API Profiles**, create a Profile with the provider protocol, Base URL, model ID, and API Key, then select it as the browser's active global Profile.
2. Optionally refresh the remote model list, or keep the manually entered model ID.
3. Import or create a character, then edit its fields and avatar if needed.
4. Import or create any worldbooks and edit their entries.
5. Create a chat with a required character, worldbooks, and optional folder. Leave the title blank to use the character name automatically.
6. Chat normally; use swipe controls or the branch map to move through the real tree.
7. Use the Inspector to edit the global Prompt Profile, configure session Regex/worldbooks, and inspect the final compiled Prompt.

The browser's currently selected API Profile is used for the next generation; changing it requires no application restart and does not rewrite a chat-session setting.

## Data and security

- The default database is `treechat.db` in the repository root when started with the provided scripts.
- Startup automatically runs the Alembic migration chain before serving requests.
- SQLite foreign keys, WAL mode, and a busy timeout are enabled.
- Directly entered API Keys are stored **unencrypted** in the local SQLite database.
- Profile read responses expose only `has_api_key`; they never return the stored Key.
- Changing a Profile's protocol, Base URL, or request path requires entering the API Key again, preventing a hidden saved Key from being silently reused against a new destination.
- Keys are not included in Prompt snapshots, Generation Runs, message history, or frontend browser storage.
- The API removes submitted input values from validation errors and does not relay raw provider error bodies.
- Leading and trailing whitespace is removed from API Key input in both the UI and backend.
- `.env`, databases, WAL/SHM files, logs, dependencies, and build output are excluded by `.gitignore`.

For legacy/API-only Profiles, `api_key_env` can reference a variable already present in the backend process environment; a directly stored Key takes precedence. Do not assume arbitrary provider keys written to `backend\.env` are exported into the process environment.

The default startup remains loopback-only. Explicit `-Lan` mode exposes only the Vite port and enables signed-cookie authentication in the backend; use the HTTPS certificate options on any LAN that is not fully trusted. This remains a development server, not a hardened public deployment.

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
npm run contract:check
npm run build
```

## Project layout

```text
backend/
  alembic/                         Database migrations
  app/api/                         Resource-specific routes and stream encoding
  app/services/generation.py       Generation lifecycle and durable partial output
  app/services/prompt_builder.py   Input loading and standalone prompt compilation
  app/services/provider_protocols/ Protocol adapters and shared HTTP transport
  app/database.py                  Application-owned engines and request sessions
  app/database_schema.py           Migration, legacy adoption, and restart recovery
  tests/                           Backend, concurrency, and migration tests
frontend/
  src/features/chat/               Per-session generation, selection, and tree cache
  src/components/                  Workspace and focused resource/configuration UI
  src/lib/api/                     HTTP clients, stream parser, and API types
  scripts/api-contract.mjs         OpenAPI type generation and verification
  src/state/                       Per-session drafts and message edits
scripts/                           Windows launchers and process ownership tracking
.github/workflows/verify.yml        Continuous integration checks
treechat.db                        Runtime database; ignored by Git
```

## Module boundaries and verification

- HTTP routes accept requests and encode responses. The generation service coordinates tree operations, prompt compilation, provider calls, and persistence. The application maps service errors to HTTP responses.
- Prompt compilation consumes detached input snapshots and can run after the database session closes. Preview and generation use the same compilation and input-budget path.
- Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses have separate request/event adapters with shared HTTP transport and error handling.
- The application factory owns or accepts a database dependency. Configuration loading and OpenAPI export do not open a database. SQLite enforces one in-progress generation per session while allowing independent sessions.
- A single frontend cache boundary reconciles server trees with streamed content. Generation controls, selection ordering, and errors are isolated by session. Invalid stream data and missing terminal events produce explicit errors.
- Run `npm run contract:generate` after backend schema changes, then review the generated diff. `npm run contract:check` verifies that the committed API types match the current OpenAPI schema.
- CI runs backend tests, API contract verification, frontend tests, and builds. A separate Windows check verifies launcher process ownership; run `./scripts/tests/runtime-processes.test.ps1` from the repository root to check it locally.

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
## SillyTavern directory import

Use **SillyTavern 导入** in the sidebar to preview and import an SSH directory, such as `oc:~/SillyTavern`, using the backend computer's existing OpenSSH configuration. The remote host needs Python 3. Preview is read-only; apply creates a SQLite online backup and adds resources in one transaction. Optionally activate the current prompt and defaults for new sessions.

From the repository root, run `./scripts/import-sillytavern.ps1 -SshHost oc -Directory '~/SillyTavern'` to preview. Add `-Apply` to import and `-Activate` to activate the current prompt/defaults. Use `-SshHost ''` for a local directory. The Python entry point is `uv run --frozen --python 3.12 python scripts/import-sillytavern.py`; it also accepts `--database-url` for an isolated database and `--report` for a secret-free JSON report.

The importer supports characters, avatars, embedded and standalone worldbooks, complete saved connections and their referenced keys, all saved credentials, chat-completion and system prompt presets, sampling parameters, and persona data. Imported prompt presets can be loaded into the global prompt editor; saved keys can be assigned without exposing their values. Repeated imports preserve local edits and report source changes. Unsupported templates/extensions are preserved as read-only configuration, with explicit conversion warnings. Chats, group chats, backgrounds, caches, backups, and plugin code are excluded and counted in the report. See [the Chinese guide](README.zh-CN.md) for details and compatibility limits.
