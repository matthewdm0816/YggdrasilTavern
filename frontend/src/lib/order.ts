// Display ordering for peer lists: alphabetical by name, id as a deterministic tiebreaker.
// zh-CN collation keeps Latin names alphabetical and orders Chinese names by pinyin.
export function sortByName<T extends { id: string; name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id, "en"));
}
