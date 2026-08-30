import { Message, RegexRule } from "./api";

export type DisplaySegment = {
  text: string;
  veiled: boolean;
  ruleId?: string;
};

export type RegexDiagnostic = {
  ruleId: string;
  message: string;
};

export type DisplayBlock = {
  id: string;
  text: string;
  veiled: boolean;
  ruleNames: string[];
};

function appliesToMessage(rule: RegexRule, role: Message["role"]): boolean {
  if (rule.targets.includes("display")) return true;
  if (role === "assistant" && rule.targets.includes("assistant_output")) return true;
  return role === "user" && rule.targets.includes("user_input");
}

export function compileRegex(rule: RegexRule): RegExp {
  return new RegExp(rule.pattern, rule.flags);
}

export function validateRegex(rule: RegexRule): string | null {
  if (!rule.pattern) return "表达式不能为空";
  if (/[^gims]/.test(rule.flags)) return "匹配选项包含不支持的旧 flags；请重新选择匹配选项";
  if (new Set(rule.flags).size !== rule.flags.length) return "匹配选项存在重复值；请重新选择匹配选项";
  if (!rule.targets.length) return "请至少选择一个应用位置";
  if (rule.mode === "veil" && rule.targets.includes("outgoing_prompt")) {
    return "隐式遮罩不能用于发送给模型的 Prompt";
  }
  try {
    compileRegex(rule);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export const validateRegexRule = validateRegex;

export function transformDisplayText(
  original: string,
  rules: RegexRule[]
): { segments: DisplaySegment[]; diagnostics: RegexDiagnostic[] } {
  const displayRules = rules.filter((rule) => rule.enabled && rule.targets.includes("display"));
  const diagnostics: RegexDiagnostic[] = [];
  let text = original;

  for (const rule of displayRules.filter((item) => item.mode === "replace")) {
    try {
      text = text.replace(compileRegex(rule), rule.replacement);
    } catch (error) {
      diagnostics.push({ ruleId: rule.id, message: error instanceof Error ? error.message : String(error) });
    }
  }

  let segments: DisplaySegment[] = [{ text, veiled: false }];
  for (const rule of displayRules.filter((item) => item.mode === "veil")) {
    let regex: RegExp;
    try {
      regex = compileRegex(rule);
    } catch (error) {
      diagnostics.push({ ruleId: rule.id, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    segments = segments.flatMap((segment) => {
      if (segment.veiled || !segment.text) return [segment];
      return splitVeiledSegments(segment.text, regex, rule.id);
    });
  }
  return { segments, diagnostics };
}

function splitVeiledSegments(text: string, regex: RegExp, ruleId: string): DisplaySegment[] {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const matcher = new RegExp(regex.source, flags);
  const segments: DisplaySegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(matcher)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ text: text.slice(cursor, index), veiled: false });
    if (match[0]) {
      segments.push({ text: match[0], veiled: true, ruleId });
      cursor = index + match[0].length;
    } else {
      cursor = Math.max(cursor, index);
    }
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), veiled: false });
  return segments.length ? segments : [{ text, veiled: false }];
}

export function transformMessageContent(content: string, role: Message["role"], rules: RegexRule[]): DisplayBlock[] {
  let displayed = content;
  const usableRules = rules.filter((rule) => rule.enabled && appliesToMessage(rule, role) && !validateRegex(rule));

  for (const rule of usableRules.filter((candidate) => candidate.mode === "replace")) {
    displayed = displayed.replace(compileRegex(rule), rule.replacement);
  }

  return displayed.split(/(\n\s*\n)/).map((text, index) => {
    if (/^\n\s*\n$/.test(text)) return { id: `separator-${index}`, text, veiled: false, ruleNames: [] };
    const matching = usableRules.filter((rule) => {
      if (rule.mode !== "veil") return false;
      const regex = compileRegex(rule);
      regex.lastIndex = 0;
      return regex.test(text);
    });
    let transformed = text;
    for (const rule of matching) transformed = transformed.replace(compileRegex(rule), rule.replacement);
    return { id: `block-${index}`, text: transformed, veiled: matching.length > 0, ruleNames: matching.map((rule) => rule.name) };
  });
}
