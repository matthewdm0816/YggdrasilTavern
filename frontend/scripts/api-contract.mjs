import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import openapiTS, { astToString } from "openapi-typescript";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(frontendRoot, "..");
const backendRoot = resolve(repositoryRoot, "backend");
const outputPath = resolve(frontendRoot, "src/lib/api/generated.ts");
const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") {
  throw new Error("Usage: node scripts/api-contract.mjs --write|--check");
}

const python = [
  "import json",
  "from app.main import create_app",
  "print(json.dumps(create_app(init_on_startup=False).openapi(), ensure_ascii=False))"
].join("\n");
const result = spawnSync("uv", ["run", "--locked", "--python", "3.12", "python", "-c", python], {
  cwd: repositoryRoot,
  encoding: "utf8",
  env: {
    ...process.env,
    PYTHONPATH: [backendRoot, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    TREECHAT_DATABASE_URL: "sqlite:///:memory:"
  },
  maxBuffer: 32 * 1024 * 1024
});
if (result.error) throw new Error("Could not run uv to export the backend OpenAPI schema.", { cause: result.error });
if (result.status !== 0) {
  throw new Error("Backend OpenAPI export failed:\n" + (result.stderr || result.stdout || "no diagnostics"));
}
let schema;
try {
  schema = JSON.parse(result.stdout);
} catch (cause) {
  throw new Error("Backend OpenAPI export did not return valid JSON:\n" + result.stdout.slice(0, 1000), { cause });
}
const generated = astToString(await openapiTS(schema));
if (mode === "--check") {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n") !== generated.replace(/\r\n/g, "\n")) {
    throw new Error("Generated API types are stale. Run npm run contract:generate in frontend and review the diff.");
  }
  console.log("Generated API types match the backend OpenAPI schema.");
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, generated, "utf8");
  console.log("Generated API types: " + outputPath);
}
