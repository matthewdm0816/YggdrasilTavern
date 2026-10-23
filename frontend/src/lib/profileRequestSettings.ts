export type CustomHeaderDraft = {
  id: string;
  name: string;
  value: string;
};

const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const authenticationHeaders = new Set(["authorization", "x-api-key", "api-key"]);
const protocolHeaders = new Set([...authenticationHeaders, "content-type"]);
const thinkingLevels = new Set(["auto", "off", "low", "medium", "high", "xhigh", "max"]);

export function customHeaderDrafts(names: readonly string[]): CustomHeaderDraft[] {
  return names.map((name, index) => ({ id: `saved-header-${index}`, name, value: "" }));
}

export function customHeaderPatch(
  headers: readonly CustomHeaderDraft[],
  savedNames: readonly string[] = []
): Record<string, string | null> {
  const saved = new Set(savedNames.map((name) => name.toLowerCase()));
  const present = new Set<string>();
  const patch = new Map<string, string | null>();
  for (const header of headers) {
    const name = header.name.trim();
    const value = header.value.trim();
    if (!name && !value) continue;
    if (!name) throw new Error("请为请求头填写名称。");
    if (!headerNamePattern.test(name)) throw new Error(`请求头名称“${name}”包含不允许的字符。`);
    const normalized = name.toLowerCase();
    if (present.has(normalized)) throw new Error(`请求头“${name}”重复；名称不区分大小写。`);
    present.add(normalized);
    if (/[^\x20-\x7e]/.test(header.value)) throw new Error(`请求头“${name}”的值只能包含可打印的 ASCII 字符，不能包含换行或控制字符。`);
    if (!value) {
      if (!saved.has(normalized)) throw new Error(`请填写新请求头“${name}”的值；只有已保存的请求头可以留空。`);
      continue;
    }
    patch.set(name, value);
  }
  for (const name of savedNames) {
    if (!present.has(name.toLowerCase())) patch.set(name, null);
  }
  return Object.fromEntries(patch);
}

export function customHeadersForCreate(headers: readonly CustomHeaderDraft[]): Record<string, string> {
  const patch = customHeaderPatch(headers);
  return Object.fromEntries(Object.entries(patch).filter((entry): entry is [string, string] => entry[1] !== null));
}

export function hasCustomHeaderAuthentication(
  headers: readonly CustomHeaderDraft[],
  savedNames: readonly string[] = []
): boolean {
  const saved = new Set(savedNames.map((name) => name.toLowerCase()));
  return headers.some((header) => {
    const name = header.name.trim().toLowerCase();
    return authenticationHeaders.has(name) && (Boolean(header.value.trim()) || saved.has(name));
  });
}

export function overriddenProtocolHeaders(headers: readonly CustomHeaderDraft[]): string[] {
  return headers.map((header) => header.name.trim()).filter((name) => protocolHeaders.has(name.toLowerCase()));
}

export function removedCustomHeaders(headers: readonly CustomHeaderDraft[], savedNames: readonly string[]): string[] {
  const present = new Set(headers.map((header) => header.name.trim().toLowerCase()));
  return savedNames.filter((name) => !present.has(name.toLowerCase()));
}

export function parseDefaultParamsJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim() || "{}");
  } catch {
    // JSON parser errors can include the user's input; keep secret values out of error messages.
    throw new Error("追加请求参数不是有效的 JSON；请检查双引号、逗号和括号。");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("追加请求参数必须是 JSON 对象，例如 {\"temperature\": 0.7}。");
  }
  const pending: unknown[] = [parsed];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("追加请求参数中的数值必须是有限数字；请缩小过大的数字。");
    }
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) pending.push(child);
    }
  }
  const params = parsed as Record<string, unknown>;
  if ("temperature" in params && (typeof params.temperature !== "number" || !Number.isFinite(params.temperature))) {
    throw new Error("JSON 中的 temperature 必须是有限数字；不需要时可删除该字段。");
  }
  if ("_thinking_level" in params && (typeof params._thinking_level !== "string" || !thinkingLevels.has(params._thinking_level))) {
    throw new Error("JSON 中的 _thinking_level 必须为 auto、off、low、medium、high、xhigh 或 max。");
  }
  return params;
}

export function updateDefaultParam(params: Record<string, unknown>, name: string, value: unknown): Record<string, unknown> {
  const next = { ...params };
  if (value === undefined) delete next[name];
  else next[name] = value;
  return next;
}
