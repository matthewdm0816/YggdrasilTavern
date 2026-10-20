import { describe, expect, it } from "vitest";
import { sortByName } from "./order";

describe("sortByName", () => {
  it("sorts peers alphabetically regardless of the incoming order", () => {
    const items = [{ id: "b", name: "Zeta service" }, { id: "c", name: "Alpha service" }];
    expect(sortByName(items).map((item) => item.name)).toEqual(["Alpha service", "Zeta service"]);
  });

  it("breaks name ties by id so the order stays deterministic", () => {
    const items = [{ id: "two", name: "Same" }, { id: "one", name: "Same" }];
    expect(sortByName(items).map((item) => item.id)).toEqual(["one", "two"]);
  });

  it("does not mutate the caller's array", () => {
    const items = [{ id: "b", name: "B" }, { id: "a", name: "A" }];
    sortByName(items);
    expect(items.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
