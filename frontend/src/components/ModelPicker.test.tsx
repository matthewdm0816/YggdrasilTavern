import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, APIProfile } from "../lib/api";
import { applyModelSelection, ModelPicker } from "./ModelPicker";

const profile: APIProfile = {
  id: "profile-one", name: "Example service", provider_type: "openai_responses",
  base_url: "https://example.invalid", model: "model-current", api_key_env: "", has_api_key: true,
  default_params: {}, input_token_limit: 262144, output_token_limit: 32768,
  model_catalog: [{ id: "model-other" }]
};

function optionLabels(html: string, groupLabel: string): string[] {
  const start = html.indexOf(`<optgroup label="${groupLabel}"`);
  if (start < 0) throw new Error(`optgroup ${groupLabel} not found`);
  const end = html.indexOf("</optgroup>", start);
  return [...html.slice(start, end).matchAll(/<option[^>]*>([^<]+)<\/option>/g)]
    .map((match) => match[1].split(" · ")[0]);
}

afterEach(() => { vi.restoreAllMocks(); });

describe("ModelPicker", () => {
  it("always displays the actual configured model and includes remote alternatives", () => {
    const html = renderToStaticMarkup(<ModelPicker profiles={[profile]} activeProfileId={profile.id} onActiveProfileChange={() => undefined} onOpenSettings={() => undefined} />);
    expect(html).toContain("当前模型");
    expect(html).toContain("model-current · Example service");
    expect(html).toContain("model-other · Example service");
    expect(html).toContain("打开模型与连接设置");
    expect(html).not.toContain(profile.base_url);
  });

  it("sorts models alphabetically inside each connection group without merging groups", () => {
    const unsorted: APIProfile = {
      ...profile, id: "profile-two", name: "Unsorted service", model: "zeta-current",
      model_catalog: [{ id: "gamma" }, { id: "alpha" }, { id: "beta" }]
    };
    const html = renderToStaticMarkup(<ModelPicker profiles={[profile, unsorted]} activeProfileId={profile.id} onActiveProfileChange={() => undefined} onOpenSettings={() => undefined} />);
    expect(optionLabels(html, "Example service")).toEqual(["model-current", "model-other"]);
    expect(optionLabels(html, "Unsorted service")).toEqual(["alpha", "beta", "gamma", "zeta-current"]);
    expect(html.indexOf('label="Example service"')).toBeLessThan(html.indexOf('label="Unsorted service"'));
    expect(optionLabels(html, "Example service")).not.toContain("alpha");
  });

  it("sorts connection groups by name while keeping each group intact", () => {
    const zeta: APIProfile = {
      ...profile, id: "profile-zeta", name: "Zeta service", model: "model-zeta", model_catalog: []
    };
    const html = renderToStaticMarkup(<ModelPicker profiles={[zeta, profile]} activeProfileId={profile.id} onActiveProfileChange={() => undefined} onOpenSettings={() => undefined} />);
    expect(html.indexOf('label="Example service"')).toBeLessThan(html.indexOf('label="Zeta service"'));
    expect(optionLabels(html, "Example service")).toEqual(["model-current", "model-other"]);
    expect(optionLabels(html, "Zeta service")).toEqual(["model-zeta"]);
  });

  it("provides settings access when no connection is configured", () => {
    const html = renderToStaticMarkup(<ModelPicker profiles={[]} activeProfileId="" onActiveProfileChange={() => undefined} onOpenSettings={() => undefined} />);
    expect(html).toContain("尚未配置模型");
    expect(html).toContain("打开模型与连接设置");
  });
});

describe("applyModelSelection", () => {
  it("switches to an existing configured model without mutating the connection", async () => {
    const update = vi.spyOn(api, "updateProfile");
    const select = vi.fn();
    const refresh = vi.fn();
    await applyModelSelection(profile, profile.model, select, refresh);
    expect(update).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith(profile.id);
  });

  it("waits for persistence and configuration refresh before changing active Profile", async () => {
    const events: string[] = [];
    let completeSave!: (value: APIProfile) => void;
    vi.spyOn(api, "updateProfile").mockImplementation(async () => {
      events.push("save-start");
      return new Promise<APIProfile>((resolve) => { completeSave = resolve; });
    });
    const select = vi.fn(() => { events.push("select"); });
    const refresh = vi.fn(async () => { events.push("refresh"); });
    const saved = vi.fn(() => { events.push("saved"); });
    const change = applyModelSelection(profile, "model-other", select, refresh, saved);
    expect(select).not.toHaveBeenCalled();
    completeSave({ ...profile, model: "model-other" });
    await change;
    expect(events).toEqual(["save-start", "saved", "refresh", "select"]);
    expect(api.updateProfile).toHaveBeenCalledWith(profile.id, { model: "model-other" });
    expect(saved).toHaveBeenCalledWith(profile.id, "model-other");
  });

  it("publishes the exact saved server response before attempting to refresh", async () => {
    const actual = { ...profile, model: "server-confirmed-model" };
    vi.spyOn(api, "updateProfile").mockResolvedValue(actual);
    const publish = vi.fn();
    const refresh = vi.fn(async () => {
      expect(publish).toHaveBeenCalledWith(actual);
      throw new Error("read failed");
    });
    await expect(applyModelSelection(profile, "model-other", vi.fn(), refresh, undefined, publish)).rejects.toThrow("模型已保存为 server-confirmed-model");
    expect(publish).toHaveBeenCalledOnce();
  });

  it("does not change the active connection if saving fails", async () => {
    vi.spyOn(api, "updateProfile").mockRejectedValue(new Error("server refused"));
    const select = vi.fn();
    const refresh = vi.fn();
    await expect(applyModelSelection(profile, "model-other", select, refresh)).rejects.toThrow("server refused");
    expect(select).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a successful save separately from a failed refresh", async () => {
    vi.spyOn(api, "updateProfile").mockResolvedValue({ ...profile, model: "model-other" });
    const select = vi.fn();
    const saved = vi.fn();
    await expect(applyModelSelection(profile, "model-other", select, async () => { throw new Error("read failed"); }, saved)).rejects.toThrow("模型已保存为 model-other");
    expect(saved).toHaveBeenCalledWith(profile.id, "model-other");
    expect(select).not.toHaveBeenCalled();
  });
});
