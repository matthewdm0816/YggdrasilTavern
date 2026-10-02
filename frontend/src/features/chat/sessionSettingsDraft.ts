import { RegexRule, SessionTree } from "../../lib/api";
import { regexRulesFromPreset, worldbookIdsFromPreset } from "../../lib/prompt";

export type SessionSettings = {
  regexRules: RegexRule[];
  worldbookIds: string[];
};

export type SessionSettingsDraft = {
  base: SessionSettings;
  value: SessionSettings;
  remote: SessionSettings;
};

export type SessionSettingsDrafts = Record<string, SessionSettingsDraft>;

export function settingsFromTree(tree: SessionTree): SessionSettings {
  const preset = tree.session.preset || {};
  return {
    regexRules: regexRulesFromPreset({ regex_rules: preset.regex_rules }),
    worldbookIds: worldbookIdsFromPreset(preset, tree.session.worldbook_id)
  };
}

function sameSettings(left: SessionSettings, right: SessionSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function settingsDirty(draft: SessionSettingsDraft): boolean {
  return !sameSettings(draft.value, draft.base);
}

export function settingsConflict(draft: SessionSettingsDraft): boolean {
  return settingsDirty(draft) && !sameSettings(draft.base, draft.remote);
}

export function reconcileSettingsDrafts(current: SessionSettingsDrafts, tree: SessionTree): SessionSettingsDrafts {
  const sessionId = tree.session.id;
  const remote = settingsFromTree(tree);
  const previous = current[sessionId];
  if (!previous) return { ...current, [sessionId]: { base: remote, value: remote, remote } };
  if (sameSettings(previous.remote, remote)) return current;
  const updated = settingsDirty(previous)
    ? { ...previous, remote }
    : { base: remote, value: remote, remote };
  return { ...current, [sessionId]: updated };
}

export function updateSettingsDraft(
  current: SessionSettingsDrafts,
  tree: SessionTree,
  update: (value: SessionSettings) => SessionSettings
): SessionSettingsDrafts {
  const sessionId = tree.session.id;
  const existing = current[sessionId];
  const remote = settingsFromTree(tree);
  const draft = existing || { base: remote, value: remote, remote };
  return { ...current, [sessionId]: { ...draft, value: update(draft.value) } };
}

export function resetSettingsDraft(current: SessionSettingsDrafts, sessionId: string): SessionSettingsDrafts {
  const draft = current[sessionId];
  if (!draft) return current;
  return { ...current, [sessionId]: { base: draft.remote, value: draft.remote, remote: draft.remote } };
}

export function markSettingsSaved(
  current: SessionSettingsDrafts,
  sessionId: string,
  submitted: SessionSettings
): SessionSettingsDrafts {
  const draft = current[sessionId];
  if (!draft) return current;
  // Only this request's snapshot was saved. Later edits remain dirty even if
  // the user switched sessions while the request was in flight.
  return { ...current, [sessionId]: { base: submitted, value: draft.value, remote: submitted } };
}
