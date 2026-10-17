import { Eye, Plus, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { type SetStateAction } from "react";
import { RegexRule, RegexTarget } from "../lib/api";
import { validateRegex } from "../lib/regex";
import { CollapsibleSection } from "./CollapsibleSection";

const targets: Array<{ value: RegexTarget; label: string; help?: string }> = [
  { value: "display", label: "聊天显示" },
  { value: "user_input", label: "用户消息" },
  { value: "assistant_output", label: "角色回复" },
  { value: "outgoing_prompt", label: "发送给模型的 Prompt", help: "仅支持显式替换" }
];

const regexFlagOptions = [
  { flag: "g", label: "替换全部命中", help: "关闭时，每段文本只替换第一个命中。" },
  { flag: "i", label: "忽略大小写", help: "" },
  { flag: "m", label: "按行匹配开头与结尾", help: "让 ^ 和 $ 对每一行分别生效。" },
  { flag: "s", label: "点号可以跨行", help: "让 . 也能匹配换行符。" }
] as const;

function id(prefix: string): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random()}`;
}

type Props = {
  selectedSessionId: string | null;
  regexRules: RegexRule[];
  setRegexRules: (update: SetStateAction<RegexRule[]>) => void;
  defaultExpanded?: boolean;
};

export function SessionRegexSection({
  selectedSessionId,
  regexRules,
  setRegexRules,
  defaultExpanded = false
}: Props) {
  function patchRule(index: number, patch: Partial<RegexRule>) {
    setRegexRules((current) => current.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));
  }

  function toggleTarget(index: number, target: RegexTarget) {
    const current = regexRules[index].targets;
    patchRule(index, { targets: current.includes(target) ? current.filter((item) => item !== target) : [...current, target] });
  }

  function toggleRegexFlag(index: number, flag: string) {
    const current = new Set(regexRules[index].flags.split("").filter((item) => "gims".includes(item)));
    if (current.has(flag)) current.delete(flag);
    else current.add(flag);
    patchRule(index, { flags: "gims".split("").filter((item) => current.has(item)).join("") });
  }

  return (
    <CollapsibleSection
      contentId="inspector-regex-content"
      title="当前会话 Regex"
      icon={<Eye size={16} />}
      storageKey="yggdrasil-tavern.inspector.regex.expanded"
      className="inspector-section"
      defaultExpanded={defaultExpanded}
      headerMeta={regexRules.length > 0 ? <span className="quiet-badge">{regexRules.length} 条</span> : undefined}
    >
      <div className="regex-rule-list">
        {regexRules.map((rule, index) => {
          const validation = validateRegex(rule);
          return (
            <details className={`regex-rule-card ${rule.enabled ? "enabled" : "disabled"}`} key={`${selectedSessionId}:${rule.id}`}>
              <summary><span>{rule.name || "未命名 Regex"}</span><small>{rule.enabled ? "已启用" : "已停用"}{validation ? " · 规则有误" : ""}</small></summary>
              <div className="regex-rule-fields">
                <header>
                  <label className="form-field"><span>规则名称</span><input value={rule.name} onChange={(event) => patchRule(index, { name: event.target.value })} /></label>
                  <button
                    type="button"
                    className={`icon-button config-toggle ${rule.enabled ? "active" : ""}`}
                    aria-pressed={rule.enabled}
                    aria-label={rule.enabled ? `停用 ${rule.name || "Regex"}` : `启用 ${rule.name || "Regex"}`}
                    title={rule.enabled ? "已启用；点击停用" : "已停用；点击启用"}
                    onClick={() => patchRule(index, { enabled: !rule.enabled })}
                  >{rule.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}</button>
                </header>
                <label className="form-field"><span>查找规则（正则表达式）</span><input value={rule.pattern} onChange={(event) => patchRule(index, { pattern: event.target.value })} /></label>
                {validation && <p className="field-error" role="alert">{validation}</p>}
                <label className="form-field"><span>替换内容</span><input value={rule.replacement} onChange={(event) => patchRule(index, { replacement: event.target.value })} /><small>可用 $1、$2 引用分组；遮罩模式下作为揭示文本。</small></label>
                <fieldset className="regex-flags">
                  <legend>匹配选项</legend>
                  {regexFlagOptions.map((option) => (
                    <label key={option.flag} title={option.help}>
                      <input type="checkbox" checked={rule.flags.includes(option.flag)} onChange={() => toggleRegexFlag(index, option.flag)} />
                      <span><strong>{option.label}</strong></span>
                    </label>
                  ))}
                </fieldset>
                <label className="form-field"><span>处理方式</span><select value={rule.mode} onChange={(event) => patchRule(index, { mode: event.target.value as RegexRule["mode"] })}>
                  <option value="replace">显式替换</option><option value="veil">隐式遮罩（点击显示）</option>
                </select></label>
                <fieldset className="target-grid">
                  <legend>应用位置</legend>
                  {targets.map((target) => <label key={target.value}><input type="checkbox" checked={rule.targets.includes(target.value)} onChange={() => toggleTarget(index, target.value)} /><span><strong>{target.label}</strong>{target.help && <small>{target.help}</small>}</span></label>)}
                </fieldset>
                <button className="icon-button danger-button" type="button" title="删除 Regex" aria-label={`删除 ${rule.name || "Regex"}`} onClick={() => setRegexRules((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button>
              </div>
            </details>
          );
        })}
      </div>
      <button className="secondary-button full-button" type="button" onClick={() => setRegexRules((current) => [...current, { id: id("regex"), name: "新 Regex", enabled: true, scope: "session", pattern: "", flags: "g", replacement: "", targets: ["display"], mode: "replace" }])}><Plus size={15} />添加 Regex</button>
    </CollapsibleSection>
  );
}
