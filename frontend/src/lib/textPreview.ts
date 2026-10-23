import type { Root, Element, Text, RootContent } from "hast";
import type { RegexRule } from "./api";
import { compileRegex, validateRegex } from "./regex";

export type TextPreview = { id: string; start: number; end: number; original: string; replacement: string };
export type PreviewResolver = (text: string) => TextPreview[];

/** Match rendered text, never edit Markdown delimiters, URLs, or element attributes. */
export function regexPreviews(text: string, rules: RegexRule[]): TextPreview[] {
  const previews: TextPreview[] = [];
  for (const rule of rules) {
    if (!rule.enabled || rule.mode !== "hover" || !rule.targets.includes("display")) continue;
    const error = validateRegex(rule);
    if (error) throw new Error(`Regex "${rule.name || rule.id}": ${error}`);
    const expression = compileRegex(rule);
    const matcher = new RegExp(expression.source, expression.flags.includes("g") ? expression.flags : expression.flags + "g");
    for (const match of text.matchAll(matcher)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (end > start && !previews.some((item) => item.start < end && item.end > start)) {
        // Sticky replacement preserves native capture, lookaround, and $prefix/$suffix semantics.
        const single = new RegExp(expression.source, expression.flags.replace(/g/g, "") + "y");
        single.lastIndex = start;
        const replaced = text.replace(single, rule.replacement);
        previews.push({ id: `${rule.id}:${start}:${end}`, start, end, original: match[0],
          replacement: replaced.slice(start, replaced.length - (text.length - end)) });
      }
      if (!expression.global) break;
    }
  }
  return previews.sort((a, b) => a.start - b.start);
}

const blockTags = new Set(["p", "li", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "tr"]);
type Container = Root | Element;

/** Keep the existing HAST structure; a cross-element match shares one preview ID. */
export function previewPlugin(resolve: PreviewResolver, restoreText: (value: string) => string = (value) => value) {
  return () => (tree: Root) => {
    let text = "";
    const positions = new Map<Text, number>();
    function collect(parent: Container) {
      for (const child of parent.children) {
        if (child.type === "text") {
          child.value = restoreText(child.value);
          positions.set(child, text.length);
          text += child.value;
        } else if (child.type === "element") {
          if (child.tagName === "br") text += "\n";
          else collect(child);
          if (blockTags.has(child.tagName)) text += "\n";
        }
      }
    }
    collect(tree);
    const previews = resolve(text);
    const emitted = new Set<string>();
    function decorate(parent: Container) {
      parent.children = parent.children.flatMap((child): RootContent[] => {
        if (child.type === "element") { decorate(child); return [child]; }
        if (child.type !== "text") return [child];
        const start = positions.get(child)!;
        const end = start + child.value.length;
        const overlaps = previews.filter((preview) => preview.start < end && preview.end > start);
        if (!overlaps.length) return [child];
        const result: RootContent[] = [];
        let cursor = start;
        for (const preview of overlaps) {
          const left = Math.max(start, preview.start);
          const right = Math.min(end, preview.end);
          if (left > cursor) result.push({ type: "text", value: child.value.slice(cursor - start, left - start) });
          result.push({
            type: "element", tagName: "span",
            properties: {
              "data-preview-id": preview.id,
              "data-preview-original": preview.original,
              "data-preview-replacement": preview.replacement,
              "data-preview-first": String(!emitted.has(preview.id)),
            },
            children: [{ type: "text", value: child.value.slice(left - start, right - start) }],
          });
          emitted.add(preview.id);
          cursor = right;
        }
        if (cursor < end) result.push({ type: "text", value: child.value.slice(cursor - start) });
        return result;
      }) as Container["children"];
    }
    decorate(tree);
  };
}
