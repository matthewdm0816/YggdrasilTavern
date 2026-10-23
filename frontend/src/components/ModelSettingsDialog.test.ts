import { describe, expect, it } from "vitest";
import type { APIProfile } from "../lib/api";
import { defaultProfile, draftFromProfile, needsModelDiscovery, profileDraftHasChanges } from "./ModelSettingsDialog";

const savedProfile: APIProfile = {
  id: "profile", name: "Example", provider_type: "anthropic_messages",
  base_url: "https://example.invalid", model: "example-model", api_key_env: "", has_api_key: true,
  default_params: { temperature: 0.7, custom: { enabled: true } }, input_token_limit: 262144, output_token_limit: 32768,
  model_catalog: [], custom_header_names: ["Authorization", "X-Client"],
  excluded_body_params: ["stream_options"], anthropic_prompt_cache: true
};

describe("needsModelDiscovery", () => {
  it("discovers models only for a configuration without a cached catalog", () => {
    expect(needsModelDiscovery({ model_catalog: [] })).toBe(true);
    expect(needsModelDiscovery({ model_catalog: [{ id: "gpt-5" }] })).toBe(false);
  });
});

describe("advanced profile drafts", () => {
  it("starts new profiles with no headers, exclusions or prompt caching", () => {
    expect(defaultProfile.custom_headers).toEqual([]);
    expect(defaultProfile.excluded_body_params).toEqual([]);
    expect(defaultProfile.anthropic_prompt_cache).toBe(false);
  });

  it("loads saved names with blank values and preserves the remaining advanced settings", () => {
    const draft = draftFromProfile(savedProfile);
    expect(draft.custom_headers.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: "Authorization", value: "" }, { name: "X-Client", value: "" }
    ]);
    expect(draft.api_key).toBe("");
    expect(draft.excluded_body_params).toEqual(["stream_options"]);
    expect(draft.excluded_body_params).not.toBe(savedProfile.excluded_body_params);
    expect(draft.anthropic_prompt_cache).toBe(true);
    expect(draft.default_params).toEqual({ _thinking_level: "auto", temperature: 0.7, custom: { enabled: true } });
    expect(profileDraftHasChanges(draft, savedProfile)).toBe(false);
  });

  it("recognizes header replacement, deletion and malformed additions as unsaved changes", () => {
    const draft = draftFromProfile(savedProfile);
    expect(profileDraftHasChanges({ ...draft, custom_headers: draft.custom_headers.map((header, index) => index ? header : { ...header, value: "replacement" }) }, savedProfile)).toBe(true);
    expect(profileDraftHasChanges({ ...draft, custom_headers: draft.custom_headers.slice(1) }, savedProfile)).toBe(true);
    expect(profileDraftHasChanges({ ...draft, custom_headers: [...draft.custom_headers, { id: "new", name: "X-New", value: "" }] }, savedProfile)).toBe(true);
    expect(profileDraftHasChanges({ ...draft, custom_headers: [...draft.custom_headers, { id: "new", name: "", value: "" }] }, savedProfile)).toBe(false);
  });

  it("recognizes changes to excluded fields and prompt caching", () => {
    const draft = draftFromProfile(savedProfile);
    expect(profileDraftHasChanges({ ...draft, excluded_body_params: [] }, savedProfile)).toBe(true);
    expect(profileDraftHasChanges({ ...draft, anthropic_prompt_cache: false }, savedProfile)).toBe(true);
  });

  it("handles older cached profiles that have not returned advanced settings yet", () => {
    const older = { ...savedProfile, custom_header_names: undefined, excluded_body_params: undefined, anthropic_prompt_cache: undefined };
    const draft = draftFromProfile(older);
    expect(draft.custom_headers).toEqual([]);
    expect(draft.excluded_body_params).toEqual([]);
    expect(draft.anthropic_prompt_cache).toBe(false);
    expect(profileDraftHasChanges(draft, older)).toBe(false);
  });
});
