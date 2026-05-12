# TreeChat Backend

Run from the repository root:

```powershell
. .\scripts\uv-env.ps1
uv sync --python 3.12
uv run uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

The app auto-creates tables on startup for local development. Alembic migration files are included for explicit migrations.
