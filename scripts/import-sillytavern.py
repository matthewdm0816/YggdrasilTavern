"""Preview/import local or SSH SillyTavern configuration without starting a server."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
CALLER_ROOT = Path.cwd()
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, str(REPO_ROOT / "backend"))
# The launcher starts uvicorn from the repository root, including relative DB URLs.
os.chdir(REPO_ROOT)

from sqlalchemy.exc import SQLAlchemyError
from app.config import get_settings
from app.database import Database
from app.database_schema import migrate_schema
from app.services.st_directory_import import apply_plan, backup_sqlite, build_plan, plan_report
from app.services.st_directory_source import read_source


def main() -> int:
    parser = argparse.ArgumentParser(description="导入 SillyTavern 配置；默认只预览，不写入数据库")
    parser.add_argument("--ssh", help="SSH 主机别名，例如 oc；省略时读取本地目录")
    parser.add_argument("--directory", default="~/SillyTavern")
    parser.add_argument("--user", default="default-user")
    parser.add_argument("--database-url", help="可选测试数据库；默认读取 Yggdrasil 的 backend/.env")
    parser.add_argument("--apply", action="store_true", help="备份数据库后正式导入")
    parser.add_argument("--activate", action="store_true", help="启用当前提示词，并给新会话设置默认连接、用户名和世界书")
    parser.add_argument("--report", type=Path, help="写入不包含密钥的 JSON 报告")
    args = parser.parse_args()
    if args.report and not args.report.is_absolute():
        args.report = CALLER_ROOT / args.report
    if not args.ssh:
        args.directory = str((CALLER_ROOT / Path(args.directory).expanduser()).resolve())
    if args.activate and not args.apply:
        parser.error("--activate 必须与 --apply 一起使用")
    database = None
    try:
        files, manifest, source = read_source(args.directory, ssh_host=args.ssh, user=args.user)
        plan = build_plan(files, manifest, source)
        report = plan_report(plan)
        if args.apply:
            if plan.errors:
                print(json.dumps(report, ensure_ascii=False, indent=2))
                return 1
            database = Database(args.database_url or get_settings().database_url)
            backup = backup_sqlite(database.engine, REPO_ROOT / ".yggdrasil-runtime" / "backups")
            # Do not run Database.initialize(): its restart recovery must never
            # interrupt generations belonging to an already-running server.
            migrate_schema(database.engine, database.database_url)
            with database.open_session() as db:
                report = apply_plan(db, plan, activate=args.activate)
            report["backup_path"] = str(backup) if backup else None
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        return 0 if report["can_apply"] else 1
    except (ValueError, OSError) as exc:
        print(f"导入失败：{exc}", file=sys.stderr)
        return 1
    except SQLAlchemyError as exc:
        # SQLAlchemy exceptions can embed SQL parameter values, including keys.
        print(f"数据库导入失败（{type(exc).__name__}）；当前导入事务已回滚。", file=sys.stderr)
        return 1
    finally:
        if database:
            database.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
