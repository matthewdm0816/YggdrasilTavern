/** Collapses Markdown source into one line of readable text for short previews. */
export function markdownPreviewText(markdown: string): string {
  return markdown
    .replace(/^\s*```.*$/gm, "")
    .replace(/^\s*([-*_]\s*){3,}$/gm, "")
    .replace(/^\s*\|?(\s*:?-{3,}:?\s*\|?)+\s*$/gm, "")
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
