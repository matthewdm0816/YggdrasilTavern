import type { Character } from "./api";
import type { TextPreview } from "./textPreview";

export type MacroCharacter = Pick<Character, "name" | "description" | "personality" | "scenario" | "first_mes" | "alternate_greetings">;
export type MacroContext = { character: MacroCharacter | null; user_name: string; original?: string; ready?: boolean };
const tokens = /\{\{(?:char|user|description|personality|scenario|charFirstMessage|original)\}\}|\{\{charFirstMessage::\p{Nd}+\}\}|<BOT>|<USER>/gu;

export function containsMacros(text: string): boolean { return new RegExp(tokens).test(text); }

// Python's \d/int accepts Unicode decimal digits; preserve that behavior in the browser.
function greetingIndex(digits: string): number {
  return Array.from(digits).reduce((value, digit) => {
    const point = digit.codePointAt(0)!;
    let start = point;
    while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start -= 1;
    return value * 10 + (point - start) % 10;
  }, 0);
}

/** Same ordered, non-recursive passes as backend/app/services/macros.py. */
export function expandMacros(text: string, context: MacroContext): string {
  const character = context.character;
  const replacements: [string, string][] = [
    ["{{char}}", character?.name ?? "Assistant"], ["<BOT>", character?.name ?? "Assistant"],
    ["{{user}}", context.user_name], ["<USER>", context.user_name],
    ["{{description}}", character?.description ?? ""], ["{{personality}}", character?.personality ?? ""],
    ["{{scenario}}", character?.scenario ?? ""], ["{{charFirstMessage}}", character?.first_mes ?? ""],
    ["{{original}}", context.original ?? ""],
  ];
  let result = text;
  for (const [token, value] of replacements) result = result.split(token).join(value);
  if (character) {
    const greetings = [character.first_mes, ...character.alternate_greetings];
    result = result.replace(/\{\{charFirstMessage::(\p{Nd}+)\}\}/gu, (_match, digits: string) => greetings[greetingIndex(digits)] ?? "");
  }
  return result;
}

export function displayMessageText(text: string, context?: MacroContext): string {
  return !context || context.ready === false ? text : expandMacros(text, context);
}

export function macroPreviews(text: string, context?: MacroContext): TextPreview[] {
  if (!context || context.ready === false) return [];
  return Array.from(text.matchAll(new RegExp(tokens))).flatMap((match) => {
    const replacement = expandMacros(match[0], context);
    if (replacement === match[0]) return [];
    return [{ id: "macro:" + match.index, start: match.index!, end: match.index! + match[0].length,
      original: match[0], replacement }];
  });
}

/** Legacy macros must remain text rather than becoming HTML nodes, including inside code. */
export function protectLegacyMacros(text: string): { text: string; restore: (value: string) => string } {
  let prefix = "\uE000macro";
  while (text.includes(prefix)) prefix += "_";
  const replacements: [string, string][] = [["<BOT>", prefix + "bot\uE001"], ["<USER>", prefix + "user\uE001"]];
  let protectedText = text;
  for (const [raw, token] of replacements) protectedText = protectedText.split(raw).join(token);
  return { text: protectedText, restore: (value) => {
    let result = value;
    for (const [raw, token] of replacements) result = result.split(token).join(raw);
    return result;
  } };
}
