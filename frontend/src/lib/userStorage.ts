/** Browser preferences belong to the authenticated account. Legacy settings stay with the owner. */
let scope = "legacy";
let userId: string | null = null;

export function setStorageUser(user: { id: string; is_owner: boolean } | null): void {
  userId = user?.id || null;
  scope = user && !user.is_owner ? user.id : "legacy";
}

export function userStorageKey(key: string): string {
  return scope === "legacy" ? key : `${key}.user.${scope}`;
}

export function accountHeaders(): Record<string, string> {
  return userId ? { "X-Yggdrasil-User": userId } : {};
}
