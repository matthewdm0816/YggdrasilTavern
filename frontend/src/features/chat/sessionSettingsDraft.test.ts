import { describe, expect, it } from "vitest";
import { RegexRule, SessionTree } from "../../lib/api";
import {
  markSettingsSaved,
  reconcileSettingsDrafts,
  resetSettingsDraft,
  settingsConflict,
  settingsDirty,
  updateSettingsDraft,
  type SessionSettings,
  type SessionSettingsDrafts
} from "./sessionSettingsDraft";

function tree(sessionId: string, worldbookIds: string[]): SessionTree {
  return {
    session: { id: sessionId, title: sessionId, preset: { worldbook_ids: worldbookIds } },
    messages: [],
    active_path_ids: []
  };
}

describe("session settings drafts", () => {
  it("updates a clean form when the same session receives new server settings", () => {
    const original = reconcileSettingsDrafts({}, tree("one", ["a"]));
    const updated = reconcileSettingsDrafts(original, tree("one", ["b"]));
    expect(updated.one.value.worldbookIds).toEqual(["b"]);
    expect(settingsDirty(updated.one)).toBe(false);
    expect(settingsConflict(updated.one)).toBe(false);
    expect(reconcileSettingsDrafts(updated, tree("one", ["b"]))).toBe(updated);
  });

  it("preserves unsaved edits across sessions and shows a conflict only when server settings change", () => {
    let drafts: SessionSettingsDrafts = reconcileSettingsDrafts({}, tree("one", ["a"]));
    drafts = updateSettingsDraft(drafts, tree("one", ["a"]), (value) => ({ ...value, worldbookIds: ["local"] }));
    drafts = reconcileSettingsDrafts(drafts, tree("two", ["other"]));
    drafts = reconcileSettingsDrafts(drafts, tree("one", ["a"]));
    expect(drafts.one.value.worldbookIds).toEqual(["local"]);
    expect(settingsConflict(drafts.one)).toBe(false);
    drafts = reconcileSettingsDrafts(drafts, tree("one", ["remote"]));
    expect(drafts.one.value.worldbookIds).toEqual(["local"]);
    expect(drafts.two.value.worldbookIds).toEqual(["other"]);
    expect(settingsConflict(drafts.one)).toBe(true);
    drafts = resetSettingsDraft(drafts, "one");
    expect(drafts.one.value.worldbookIds).toEqual(["remote"]);
    expect(settingsDirty(drafts.one)).toBe(false);
  });

  it("marks a successful save as the new baseline before a refreshed server tree arrives", () => {
    let drafts = reconcileSettingsDrafts({}, tree("one", ["a"]));
    drafts = updateSettingsDraft(drafts, tree("one", ["a"]), (value) => ({ ...value, worldbookIds: ["saved"] }));
    drafts = markSettingsSaved(drafts, "one", drafts.one.value, drafts.one.value);
    expect(settingsDirty(drafts.one)).toBe(false);
    drafts = reconcileSettingsDrafts(drafts, tree("one", ["saved"]));
    expect(settingsConflict(drafts.one)).toBe(false);
  });

  it("acknowledges the submitted snapshot without marking later edits saved", () => {
    const originalTree = tree("one", ["a"]);
    let drafts = reconcileSettingsDrafts({}, originalTree);
    drafts = updateSettingsDraft(drafts, originalTree, (value) => ({ ...value, worldbookIds: ["submitted"] }));
    const submitted = drafts.one.value;
    drafts = updateSettingsDraft(drafts, originalTree, (value) => ({ ...value, worldbookIds: ["new-edit"] }));
    drafts = markSettingsSaved(drafts, "one", submitted, submitted);
    drafts = reconcileSettingsDrafts(drafts, tree("one", ["submitted"]));
    expect(drafts.one.base.worldbookIds).toEqual(["submitted"]);
    expect(drafts.one.value.worldbookIds).toEqual(["new-edit"]);
    expect(settingsDirty(drafts.one)).toBe(true);
    expect(settingsConflict(drafts.one)).toBe(false);
  });

  it("keeps a save acknowledgement scoped to its original session after switching", () => {
    const one = tree("one", ["a"]);
    const two = tree("two", ["b"]);
    let drafts = reconcileSettingsDrafts({}, one);
    drafts = updateSettingsDraft(drafts, one, (value) => ({ ...value, worldbookIds: ["submitted"] }));
    const submitted = drafts.one.value;
    drafts = reconcileSettingsDrafts(drafts, two);
    drafts = updateSettingsDraft(drafts, two, (value) => ({ ...value, worldbookIds: ["other-edit"] }));
    drafts = markSettingsSaved(drafts, "one", submitted, submitted);
    expect(settingsDirty(drafts.one)).toBe(false);
    expect(drafts.two.base.worldbookIds).toEqual(["b"]);
    expect(drafts.two.value.worldbookIds).toEqual(["other-edit"]);
    expect(settingsDirty(drafts.two)).toBe(true);
  });

  it("adopts the server regex field order after an unchanged form is saved", () => {
    const original = tree("one", []);
    const rule: RegexRule = {
      id: "regex", name: "新 Regex", enabled: true, scope: "session",
      pattern: "故事", flags: "g", replacement: "故事", targets: ["display"], mode: "replace"
    };
    let drafts = reconcileSettingsDrafts({}, original);
    drafts = updateSettingsDraft(drafts, original, (value) => ({ ...value, regexRules: [rule] }));
    const submitted = drafts.one.value;
    const saved: SessionSettings = {
      regexRules: [{
        enabled: true, flags: "g", id: "regex", mode: "replace", name: "新 Regex",
        pattern: "故事", replacement: "故事", scope: "session", targets: ["display"]
      }],
      worldbookIds: []
    };
    expect(saved).toEqual(submitted);
    expect(JSON.stringify(saved)).not.toBe(JSON.stringify(submitted));
    drafts = markSettingsSaved(drafts, "one", submitted, saved);
    expect(drafts.one.value).toBe(saved);
    expect(drafts.one.base).toBe(saved);
    expect(drafts.one.remote).toBe(saved);
    expect(settingsDirty(drafts.one)).toBe(false);
    expect(settingsConflict(drafts.one)).toBe(false);
    drafts = reconcileSettingsDrafts(drafts, {
      ...original, session: { ...original.session, preset: { regex_rules: saved.regexRules } }
    });
    expect(settingsDirty(drafts.one)).toBe(false);
  });

  it("adopts normalized server values without preserving a falsely dirty form", () => {
    const original = tree("one", []);
    let drafts = reconcileSettingsDrafts({}, original);
    drafts = updateSettingsDraft(drafts, original, (value) => ({ ...value, worldbookIds: [" a ", "a"] }));
    const submitted = drafts.one.value;
    const saved: SessionSettings = { regexRules: [], worldbookIds: ["a"] };
    drafts = markSettingsSaved(drafts, "one", submitted, saved);
    expect(drafts.one.value.worldbookIds).toEqual(["a"]);
    expect(settingsDirty(drafts.one)).toBe(false);
    expect(settingsConflict(drafts.one)).toBe(false);
  });

  it("preserves a newer edit while accepting normalized server values as the baseline", () => {
    const original = tree("one", []);
    let drafts = reconcileSettingsDrafts({}, original);
    drafts = updateSettingsDraft(drafts, original, (value) => ({ ...value, worldbookIds: [" a ", "a"] }));
    const submitted = drafts.one.value;
    const saved: SessionSettings = { regexRules: [], worldbookIds: ["a"] };
    drafts = updateSettingsDraft(drafts, original, (value) => ({ ...value, worldbookIds: ["new-edit"] }));
    const newer = drafts.one.value;
    drafts = markSettingsSaved(drafts, "one", submitted, saved);
    expect(drafts.one.value).toBe(newer);
    expect(drafts.one.base).toBe(saved);
    expect(drafts.one.remote).toBe(saved);
    expect(settingsDirty(drafts.one)).toBe(true);
    expect(settingsConflict(drafts.one)).toBe(false);
    drafts = reconcileSettingsDrafts(drafts, tree("one", ["a"]));
    expect(drafts.one.value).toBe(newer);
    expect(settingsConflict(drafts.one)).toBe(false);
  });

  it("preserves edits made during a save and keeps another session's draft independent", () => {
    const original = tree("one", ["original"]);
    let drafts = reconcileSettingsDrafts({}, original);
    drafts = updateSettingsDraft(drafts, original, (value) => ({ ...value, worldbookIds: ["submitted"] }));
    const submitted = drafts.one.value;
    drafts = updateSettingsDraft(drafts, original, (value) => ({
      ...value,
      worldbookIds: ["later"],
      regexRules: [{ id: "later-rule", name: "Later edit", enabled: true, scope: "session", pattern: "old", flags: "g", replacement: "new", targets: ["display"], mode: "replace" }]
    }));
    drafts = reconcileSettingsDrafts(drafts, tree("two", ["other"]));
    drafts = updateSettingsDraft(drafts, tree("two", ["other"]), (value) => ({ ...value, worldbookIds: ["other-edit"] }));
    const later = drafts.one.value;
    const other = drafts.two;

    drafts = markSettingsSaved(drafts, "one", submitted, submitted);
    drafts = reconcileSettingsDrafts(drafts, tree("one", submitted.worldbookIds));

    expect(drafts.one.value).toEqual(later);
    expect(drafts.one.base).toEqual(submitted);
    expect(settingsDirty(drafts.one)).toBe(true);
    expect(settingsConflict(drafts.one)).toBe(false);
    expect(drafts.two).toBe(other);

    drafts = markSettingsSaved(drafts, "one", later, later);
    expect(settingsDirty(drafts.one)).toBe(false);
    expect(settingsConflict(drafts.one)).toBe(false);
  });

  it("keeps reverting to the original value during a save as an unsaved edit", () => {
    const original = tree("one", ["original"]);
    let drafts = reconcileSettingsDrafts({}, original);
    drafts = updateSettingsDraft(drafts, original, (value) => ({ ...value, worldbookIds: ["submitted"] }));
    const submitted = drafts.one.value;
    drafts = updateSettingsDraft(drafts, original, (value) => ({ ...value, worldbookIds: ["original"] }));

    drafts = markSettingsSaved(drafts, "one", submitted, submitted);
    drafts = reconcileSettingsDrafts(drafts, tree("one", submitted.worldbookIds));

    expect(drafts.one.value.worldbookIds).toEqual(["original"]);
    expect(settingsDirty(drafts.one)).toBe(true);
    expect(settingsConflict(drafts.one)).toBe(false);
  });
});
