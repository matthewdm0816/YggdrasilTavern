import { PromptSlot, PromptSlotKind, RegexRule } from "./api";

export const BUILTIN_PROMPT_SLOT_KINDS: PromptSlotKind[] = [
  "main",
  "world_before",
  "char_description",
  "char_personality",
  "scenario",
  "examples",
  "pre_history",
  "history",
  "world_after",
  "post_history"
];

export const DEFAULT_PROMPT_SLOTS: PromptSlot[] = [
  { id: "main", kind: "main", name: "Main Prompt", enabled: true, role: "system", content: null },
  { id: "world_before", kind: "world_before", name: "World Info Before", enabled: true, role: "system", content: null },
  { id: "char_description", kind: "char_description", name: "Character Description", enabled: true, role: "system", content: null },
  { id: "char_personality", kind: "char_personality", name: "Character Personality", enabled: true, role: "system", content: null },
  { id: "scenario", kind: "scenario", name: "Scenario", enabled: true, role: "system", content: null },
  { id: "examples", kind: "examples", name: "Example Dialogue", enabled: true, role: "system", content: null },
  { id: "pre_history", kind: "pre_history", name: "Pre-History Instruction", enabled: true, role: "system", content: null },
  { id: "history", kind: "history", name: "Chat History", enabled: true, role: "system", content: null },
  { id: "world_after", kind: "world_after", name: "World Info After", enabled: true, role: "system", content: null },
  { id: "post_history", kind: "post_history", name: "Post-History Instruction", enabled: true, role: "system", content: null }
];

export function defaultPromptSlots(): PromptSlot[] {
  return DEFAULT_PROMPT_SLOTS.map((slot) => ({ ...slot }));
}

export function promptSlotsFromPreset(preset: Record<string, unknown> | undefined): PromptSlot[] {
  const raw = preset?.prompt_slots;
  if (!Array.isArray(raw)) return defaultPromptSlots();
  const slots = raw.filter(isPromptSlot).map((slot) => ({ ...slot }));
  const hasRequired = BUILTIN_PROMPT_SLOT_KINDS.every(
    (kind) => slots.filter((slot) => slot.kind === kind && slot.id === kind).length === 1
  );
  return hasRequired ? slots : defaultPromptSlots();
}

export function regexRulesFromPreset(preset: Record<string, unknown> | undefined): RegexRule[] {
  const raw = preset?.regex_rules;
  return Array.isArray(raw) ? raw.filter(isRegexRule).map((rule) => ({ ...rule, scope: rule.scope || "session", targets: [...rule.targets] })) : [];
}

export function worldbookIdsFromPreset(
  preset: Record<string, unknown> | undefined,
  legacyWorldbookId?: string | null
): string[] {
  const raw = preset?.worldbook_ids;
  const ids = [legacyWorldbookId, ...(Array.isArray(raw) ? raw : [])]
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
  return [...new Set(ids)];
}

function isPromptSlot(value: unknown): value is PromptSlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as Partial<PromptSlot>;
  return (
    typeof slot.id === "string" &&
    typeof slot.kind === "string" &&
    typeof slot.name === "string" &&
    typeof slot.enabled === "boolean" &&
    ["system", "user", "assistant"].includes(slot.role || "") &&
    (typeof slot.content === "string" || slot.content === null)
  );
}

function isRegexRule(value: unknown): value is RegexRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Partial<RegexRule>;
  return (
    typeof rule.id === "string" &&
    typeof rule.pattern === "string" &&
    typeof rule.flags === "string" &&
    typeof rule.replacement === "string" &&
    Array.isArray(rule.targets) &&
    (rule.mode === "replace" || rule.mode === "veil")
  );
}
