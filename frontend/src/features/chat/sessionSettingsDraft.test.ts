import { describe, expect, it } from "vitest";
import { SessionTree } from "../../lib/api";
import {
  markSettingsSaved,
  reconcileSettingsDrafts,
  resetSettingsDraft,
  settingsConflict,
  settingsDirty,
  updateSettingsDraft,
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
    drafts = markSettingsSaved(drafts, "one", drafts.one.value);
    expect(settingsDirty(drafts.one)).toBe(false);
    drafts = reconcileSettingsDrafts(drafts, tree("one", ["saved"]));
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

    drafts = markSettingsSaved(drafts, "one", submitted);
    drafts = reconcileSettingsDrafts(drafts, tree("one", submitted.worldbookIds));

    expect(drafts.one.value).toEqual(later);
    expect(drafts.one.base).toEqual(submitted);
    expect(settingsDirty(drafts.one)).toBe(true);
    expect(settingsConflict(drafts.one)).toBe(false);
    expect(drafts.two).toBe(other);

    drafts = markSettingsSaved(drafts, "one", later);
    expect(settingsDirty(drafts.one)).toBe(false);
    expect(settingsConflict(drafts.one)).toBe(false);
  });

  it("keeps reverting to the original value during a save as an unsaved edit", () => {
    const original = tree("one", ["original"]);
    let drafts = reconcileSettingsDrafts({}, original);
    drafts = updateSettingsDraft(drafts, original, (value) => ({ ...value, worldbookIds: ["submitted"] }));
    const submitted = drafts.one.value;
    drafts = updateSettingsDraft(drafts, original, (value) => ({ ...value, worldbookIds: ["original"] }));

    drafts = markSettingsSaved(drafts, "one", submitted);
    drafts = reconcileSettingsDrafts(drafts, tree("one", submitted.worldbookIds));

    expect(drafts.one.value.worldbookIds).toEqual(["original"]);
    expect(settingsDirty(drafts.one)).toBe(true);
    expect(settingsConflict(drafts.one)).toBe(false);
  });
});
