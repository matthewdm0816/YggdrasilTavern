import { describe, expect, it } from "vitest";
import { needsModelDiscovery } from "./ModelSettingsDialog";

describe("needsModelDiscovery", () => {
  it("discovers models only for a configuration without a cached catalog", () => {
    expect(needsModelDiscovery({ model_catalog: [] })).toBe(true);
    expect(needsModelDiscovery({ model_catalog: [{ id: "gpt-5" }] })).toBe(false);
  });
});
