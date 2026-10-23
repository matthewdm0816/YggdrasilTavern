import { useRef } from "react";
import { Plus, Settings2, Trash2 } from "lucide-react";
import type { ProviderType } from "../lib/api";
import { overriddenProtocolHeaders, removedCustomHeaders, type CustomHeaderDraft } from "../lib/profileRequestSettings";
import { CollapsibleSection } from "./CollapsibleSection";
import { CommaListInput } from "./CommaListInput";

type Props = {
  providerType: ProviderType;
  headers: CustomHeaderDraft[];
  savedHeaderNames: readonly string[];
  onHeadersChange: (headers: CustomHeaderDraft[]) => void;
  defaultParamsJson: string;
  onDefaultParamsJsonChange: (text: string) => void;
  jsonError: string | null;
  headersError: string | null;
  excludedBodyParams: string[];
  onExcludedBodyParamsChange: (names: string[]) => void;
  anthropicPromptCache: boolean;
  onAnthropicPromptCacheChange: (enabled: boolean) => void;
  disabled: boolean;
};

export function ProfileRequestSettings({
  providerType, headers, savedHeaderNames, onHeadersChange,
  defaultParamsJson, onDefaultParamsJsonChange, jsonError, headersError,
  excludedBodyParams, onExcludedBodyParamsChange,
  anthropicPromptCache, onAnthropicPromptCacheChange, disabled
}: Props) {
  const nextHeaderId = useRef(0);
  const savedNames = new Set(savedHeaderNames.map((name) => name.toLowerCase()));
  const overridden = overriddenProtocolHeaders(headers);
  const removed = removedCustomHeaders(headers, savedHeaderNames);
  return (
    <CollapsibleSection
      title="高级请求设置"
      icon={<Settings2 size={16} />}
      contentId="profile-advanced-request-settings"
      storageKey="treechat.profile-advanced-request-settings"
      className="profile-advanced-settings"
    >
      <fieldset className="profile-request-fields" disabled={disabled}>
        <div className="profile-request-headers">
          <div className="form-caption"><strong>自定义请求头</strong><button className="secondary-button" type="button" onClick={() => {
            onHeadersChange([...headers, { id: `new-header-${nextHeaderId.current++}`, name: "", value: "" }]);
          }}><Plus size={14} />添加请求头</button></div>
          <small className="model-request-note">已保存的值不会回传。留空保留原值，输入新值替换；删除该行后保存会移除请求头。</small>
          {savedHeaderNames.length > 0 && <small className="model-request-note">更改协议、服务地址或请求路径时，请重新填写或移除已保存的请求头。</small>}
          {headers.map((header, index) => (
            <div className="profile-request-header-row" key={header.id}>
              <label className="form-field"><span>请求头名称 {index + 1}</span><input
                value={header.name}
                placeholder="X-Custom-Header"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(headersError)}
                onChange={(event) => onHeadersChange(headers.map((item) => item.id === header.id ? { ...item, name: event.target.value } : item))}
              /></label>
              <label className="form-field"><span>请求头值 {index + 1}</span><input
                type="password"
                value={header.value}
                placeholder={savedNames.has(header.name.trim().toLowerCase()) ? "已保存；留空保留原值" : "输入请求头值"}
                autoComplete="new-password"
                spellCheck={false}
                aria-invalid={Boolean(headersError)}
                onChange={(event) => onHeadersChange(headers.map((item) => item.id === header.id ? { ...item, value: event.target.value } : item))}
              /></label>
              <button className="icon-button danger-button" type="button" aria-label={`删除请求头 ${header.name || index + 1}`} title="删除请求头" onClick={() => onHeadersChange(headers.filter((item) => item.id !== header.id))}><Trash2 size={15} /></button>
            </div>
          ))}
          {removed.length > 0 && <p className="model-request-note">保存后将删除：{removed.join("、")}。</p>}
          {overridden.length > 0 && <p className="model-request-warning">这些请求头会覆盖协议默认值：{overridden.join("、")}。{overridden.some((name) => name.toLowerCase() === "authorization") ? "Authorization 的值需要包含服务商要求的认证前缀，例如 Bearer。" : ""}</p>}
        </div>
        <label className="form-field"><span>追加请求参数（JSON 对象）</span><textarea
          className="profile-request-json"
          rows={7}
          value={defaultParamsJson}
          spellCheck={false}
          aria-invalid={Boolean(jsonError)}
          onChange={(event) => onDefaultParamsJsonChange(event.target.value)}
        /><small>与上方 Temperature 和思考强度同步。temperature 对应 Temperature，_thinking_level 对应思考强度；其他字段会追加到请求体。</small></label>
        <label className="form-field"><span>排除请求体字段（逗号分隔）</span><CommaListInput value={excludedBodyParams} onChange={onExcludedBodyParamsChange} /><small>从最终请求体移除这些顶层字段，例如 stream_options, parallel_tool_calls。</small></label>
        {providerType === "anthropic_messages" && <div className="profile-request-cache">
          <label className="switch-label"><input type="checkbox" checked={anthropicPromptCache} onChange={(event) => onAnthropicPromptCacheChange(event.target.checked)} /><span>启用 Anthropic 提示词缓存</span></label>
          <small className="model-request-note">默认关闭。5 分钟缓存的写入费用通常为普通输入的 1.25 倍，命中费用通常为 0.1 倍；最低缓存长度随模型而异，短提示词可能不会命中。缓存默认保留 5 分钟，具体价格以服务商为准。<a href="https://platform.claude.com/docs/en/build-with-claude/prompt-caching" target="_blank" rel="noopener noreferrer">查看官方说明</a></small>
        </div>}
      </fieldset>
    </CollapsibleSection>
  );
}
