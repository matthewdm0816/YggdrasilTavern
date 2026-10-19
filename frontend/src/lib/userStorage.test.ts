import { afterEach, describe, expect, it } from "vitest";
import { accountHeaders, setStorageUser, userStorageKey } from "./userStorage";

afterEach(() => setStorageUser(null));

describe("account preferences and request identity", () => {
  it("preserves legacy browser preferences for the owner and separates every new user", () => {
    const key = "yggdrasil-tavern.active-api-profile";
    setStorageUser({ id: "owner", is_owner: true });
    expect(userStorageKey(key)).toBe(key);
    expect(accountHeaders()).toEqual({ "X-Yggdrasil-User": "owner" });
    setStorageUser({ id: "alice", is_owner: false });
    const aliceKey = userStorageKey(key);
    setStorageUser({ id: "bob", is_owner: false });
    expect(userStorageKey(key)).not.toBe(aliceKey);
    expect(userStorageKey(key)).not.toBe(key);
    expect(accountHeaders()).toEqual({ "X-Yggdrasil-User": "bob" });
    setStorageUser(null);
    expect(accountHeaders()).toEqual({});
  });
});
