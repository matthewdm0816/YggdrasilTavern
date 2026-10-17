import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CloudDownload, Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";
import { api, APIProfile, ProviderType, RemoteModelInfo } from "../lib/api";

export type ProfileDraft = {
  name: string;
  provider_type: ProviderType;
  base_url: string;
  path_override: string;
  model: string;
  api_key: string;
  default_params: Record<string, unknown>;
  input_token_limit: number;
  output_token_limit: number;
};

export const defaultProfile: ProfileDraft = {
  name: "OpenAI Responses",
  provider_type: "openai_responses",
  base_url: "https://api.openai.com",
  path_override: "",
  model: "gpt-5",
  api_key: "",
  default_params: { _thinking_level: "auto" },
  input_token_limit: 256 * 1024,
  output_token_limit: 32 * 1024
};

const thinkingLevelOptions = [
  { value: "auto", label: "自动" },
  { value: "off", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "更高" },
  { value: "max", label: "最大" }
] as const;

export function fallbackProfileIdAfterDelete(profiles: Array<Pick<APIProfile, "id">>, deletedProfileId: string) {
  return profiles.find((profile) => profile.id !== deletedProfileId)?.id || "";
}

export function formatTokenLimit(value?: number | null): string {
  if (!value) return "未知";
  if (value % 1024 === 0) return `${value / 1024}K`;
  return value.toLocaleString();
}

export function profileDraftHasChanges(draft: ProfileDraft, existing?: APIProfile) {
  if (!existing) return true;
  return draft.name.trim() !== existing.name
    || draft.provider_type !== existing.provider_type
    || draft.base_url.trim() !== existing.base_url
    || (draft.path_override || null) !== (existing.path_override || null)
    || draft.model.trim() !== existing.model
    || Boolean(draft.api_key.trim())
    || draft.input_token_limit !== existing.input_token_limit
    || draft.output_token_limit !== existing.output_token_limit
    || JSON.stringify(draft.default_params) !== JSON.stringify({ _thinking_level: "auto", ...existing.default_params });
}

function effectiveProfileLimits(profile: APIProfile, model?: RemoteModelInfo) {
  const output = model?.max_output_tokens
    ? Math.min(profile.output_token_limit, model.max_output_tokens)
    : profile.output_token_limit;
  let input = model?.max_input_tokens
    ? Math.min(profile.input_token_limit, model.max_input_tokens)
    : profile.input_token_limit;
  if (model?.max_total_tokens) input = Math.min(input, Math.max(0, model.max_total_tokens - output));
  return { input, output };
}

function remoteModelLabel(model: RemoteModelInfo): string {
  const limits = model.max_total_tokens
    ? `总窗 ${formatTokenLimit(model.max_total_tokens)}`
    : model.max_input_tokens ? `输入 ${formatTokenLimit(model.max_input_tokens)}` : "";
  return `${model.display_name || model.id}${model.display_name ? ` · ${model.id}` : ""}${limits ? ` · ${limits}` : ""}`;
}

function profileConnectionKey(profile: APIProfile): string {
  return JSON.stringify([profile.id, profile.provider_type, profile.base_url, profile.path_override]);
}

type Props = {
  profiles: APIProfile[];
  activeProfileId: string;
  onActiveProfileChange: (id: string) => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  onRefresh: () => Promise<void>;
  onError?: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onProfileUpdated?: (profile: APIProfile) => void;
};

export function ModelSettingsDialog({
  profiles,
  activeProfileId,
  onActiveProfileChange,
  settingsOpen,
  onCloseSettings,
  onRefresh,
  onError,
  onBusyChange,
  onProfileUpdated
}: Props) {
  const [profile, setProfile] = useState(defaultProfile);
  const [busy, setBusy] = useState(false);
  const [refreshingProfileId, setRefreshingProfileId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelNotices, setModelNotices] = useState<Record<string, string>>({});
  const [draftModels, setDraftModels] = useState<RemoteModelInfo[]>([]);
  const [draftModelsNotice, setDraftModelsNotice] = useState("");
  const [discoveringDraftModels, setDiscoveringDraftModels] = useState(false);
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0);
  const attemptedProfiles = useRef(new Set<string>());
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const activeProfile = profiles.find((item) => item.id === activeProfileId);
  const editedProfile = profiles.find((item) => item.id === editingProfileId);
  const profileDirty = profileDraftHasChanges(profile, editedProfile);
  const activeConnectionKey = activeProfile ? profileConnectionKey(activeProfile) : "";
  const activeCatalog = activeProfile?.model_catalog || [];
  const activeRemoteModel = activeCatalog.find((item) => item.id === activeProfile?.model);
  const activeEffectiveLimits = activeProfile
    ? effectiveProfileLimits(activeProfile, activeRemoteModel)
    : null;

  useEffect(() => {
    if (!activeProfile || attemptedProfiles.current.has(activeConnectionKey)) return;
    attemptedProfiles.current.add(activeConnectionKey);
    void refreshProfileModels(activeProfile.id);
  }, [activeConnectionKey]);

  useEffect(() => {
    if (!profileEditorOpen) return;
    const controller = new AbortController();
    const existing = profiles.find((item) => item.id === editingProfileId);
    setDraftModels([]);
    setDiscoveringDraftModels(false);
    if (!profile.base_url.trim() || (!profile.api_key.trim() && !existing?.has_api_key && !existing?.api_key_env)) {
      setDraftModelsNotice("填写服务地址和 API Key 后自动获取模型列表；也可直接手输模型名称。");
      return;
    }
    setDraftModelsNotice("等待获取模型列表…");
    const timer = window.setTimeout(async () => {
      setDiscoveringDraftModels(true);
      try {
        const result = await api.discoverProfileModels({
          provider_type: profile.provider_type,
          base_url: profile.base_url.trim(),
          path_override: profile.path_override || null,
          api_key: profile.api_key.trim() || null,
          profile_id: editingProfileId
        }, controller.signal);
        if (controller.signal.aborted) return;
        setDraftModels(result.models);
        setDraftModelsNotice(result.available
          ? (result.models.length ? `已获取 ${result.models.length} 个模型。` : "服务商返回空列表；请手动填写模型名称。")
          : result.message || "无法获取模型列表；请手动填写模型名称。");
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("无法获取编辑中的 API 配置的模型列表。", cause);
        setDraftModelsNotice(`无法获取模型列表：${cause instanceof Error ? cause.message : String(cause)}；仍可手动填写。`);
      } finally {
        if (!controller.signal.aborted) setDiscoveringDraftModels(false);
      }
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [profileEditorOpen, editingProfileId, profile.provider_type, profile.base_url, profile.path_override, profile.api_key, discoveryAttempt]);

  useEffect(() => {
    const dialog = settingsDialogRef.current;
    if (!dialog) return;
    if (settingsOpen && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!settingsOpen && dialog.open) {
      dialog.close();
      returnFocusRef.current?.focus();
    }
  }, [settingsOpen]);

  useEffect(() => {
    onBusyChange?.(busy || refreshingProfileId !== null);
  }, [busy, refreshingProfileId, onBusyChange]);

  function reportProfileError(message: string) {
    setProfileError(message);
    onError?.(message);
  }

  function resetProfileEditor() {
    setEditingProfileId(null);
    setProfile(defaultProfile);
    setProfileEditorOpen(false);
    setShowApiKey(false);
  }

  function createProfileDraft() {
    setProfileError(null);
    setProfileNotice(null);
    setEditingProfileId(null);
    setProfile(defaultProfile);
    setProfileEditorOpen(true);
    setShowApiKey(false);
  }

  function editProfile(item: APIProfile) {
    setProfileError(null);
    setProfileNotice(null);
    setEditingProfileId(item.id);
    setProfile({
      name: item.name,
      provider_type: item.provider_type,
      base_url: item.base_url,
      path_override: item.path_override || "",
      model: item.model,
      api_key: "",
      default_params: { _thinking_level: "auto", ...item.default_params },
      input_token_limit: item.input_token_limit,
      output_token_limit: item.output_token_limit
    });
    setProfileEditorOpen(true);
    setShowApiKey(false);
  }

  async function saveProfile() {
    if (!profile.name.trim() || !profile.base_url.trim() || !profile.model.trim()) {
      reportProfileError("请填写连接配置名称、服务地址和模型名称");
      return;
    }
    const existing = editingProfileId ? profiles.find((item) => item.id === editingProfileId) : undefined;
    if (!profile.api_key.trim() && !existing?.has_api_key && !existing?.api_key_env) {
      reportProfileError("请填写 API Key；保存后会遮罩，编辑时留空表示不替换");
      return;
    }
    if (!Number.isFinite(profile.input_token_limit) || !Number.isFinite(profile.output_token_limit) || profile.input_token_limit < 1024 || profile.output_token_limit < 1) {
      reportProfileError("输入上限至少为 1024 tokens，输出上限必须大于 0");
      return;
    }
    setProfileError(null);
    setProfileNotice(null);
    setBusy(true);
    try {
      let createdProfileId: string | null = null;
      let savedProfile: APIProfile;
      const payload = {
        name: profile.name.trim(),
        provider_type: profile.provider_type,
        base_url: profile.base_url.trim(),
        path_override: profile.path_override || null,
        model: profile.model.trim(),
        ...(profile.api_key.trim() ? { api_key: profile.api_key.trim() } : {}),
        default_params: profile.default_params,
        input_token_limit: profile.input_token_limit,
        output_token_limit: profile.output_token_limit
      };
      if (editingProfileId) {
        savedProfile = await api.updateProfile(editingProfileId, payload);
        onProfileUpdated?.(savedProfile);
      } else {
        const created = await api.createProfile(payload);
        savedProfile = created;
        createdProfileId = created.id;
        onProfileUpdated?.(created);
      }
      const connectionKey = profileConnectionKey(savedProfile);
      attemptedProfiles.current.add(connectionKey);
      setProfileNotice(`已保存连接配置“${profile.name.trim()}”。`);
      resetProfileEditor();
      await onRefresh();
      if (createdProfileId) onActiveProfileChange(createdProfileId);
      void refreshProfileModels(savedProfile.id, connectionKey);
    } catch (exc) {
      reportProfileError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile(item: APIProfile) {
    if (!window.confirm(`删除连接配置“${item.name}”？`)) return;
    setProfileError(null);
    setProfileNotice(null);
    setBusy(true);
    try {
      await api.deleteProfile(item.id);
      setProfileNotice(`已删除连接配置“${item.name}”。`);
      if (editingProfileId === item.id) resetProfileEditor();
      if (activeProfileId === item.id) {
        onActiveProfileChange(fallbackProfileIdAfterDelete(profiles, item.id));
      }
      await onRefresh();
    } catch (exc) {
      reportProfileError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  async function refreshProfileModels(profileId: string, connectionKeyOverride?: string) {
    const item = profiles.find((entry) => entry.id === profileId);
    const connectionKey = connectionKeyOverride || (item ? profileConnectionKey(item) : profileId);
    setRefreshingProfileId(profileId);
    try {
      const response = await api.refreshProfileModels(profileId);
      setModelNotices((current) => ({
        ...current,
        [connectionKey]: response.available
          ? (response.models.length ? `已获取 ${response.models.length} 个模型。` : "服务商返回空列表；可在编辑配置中手输模型名称。")
          : response.message || "无法获取模型列表；仍可手动填写模型名称。"
      }));
      if (response.available) {
        await onRefresh();
      }
    } catch (exc) {
      console.error("无法刷新模型列表。", exc);
      setModelNotices((current) => ({
        ...current,
        [connectionKey]: `无法获取模型列表：${exc instanceof Error ? exc.message : String(exc)}；仍可手动填写模型名称。`
      }));
    } finally {
      setRefreshingProfileId(null);
    }
  }

  async function selectRemoteModel(profileId: string, model: string) {
    if (!model) return;
    setProfileError(null);
    setProfileNotice(null);
    setRefreshingProfileId(profileId);
    try {
      const saved = await api.updateProfile(profileId, { model });
      onProfileUpdated?.(saved);
      setProfileNotice(`已切换到 ${model}。`);
      await onRefresh();
    } catch (exc) {
      reportProfileError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setRefreshingProfileId(null);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={settingsDialogRef}
      className="model-settings-dialog"
      aria-labelledby="model-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && refreshingProfileId === null) onCloseSettings();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy || refreshingProfileId !== null) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onCloseSettings();
      }}
    >
      <header className="model-settings-header">
        <div><h2 id="model-settings-title">模型与连接设置</h2></div>
        <button className="icon-button" type="button" aria-label="关闭模型与连接设置" disabled={busy || refreshingProfileId !== null} onClick={onCloseSettings}><X size={18} /></button>
      </header>
      <div className="model-settings-content">
        {profileError && <p className="field-error" role="alert">{profileError}</p>}
        {profileNotice && <p className="model-settings-notice" role="status">{profileNotice}</p>}
        <div className="profile-selector-row">
          <label className="form-field">
            <span>当前连接配置（所有会话共用）</span>
            <select disabled={busy || refreshingProfileId !== null} value={activeProfile?.id || ""} onChange={(event) => { resetProfileEditor(); onActiveProfileChange(event.target.value); }}>
              <option value="">未选择连接配置</option>
              {profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}
            </select>
          </label>
          <div className="profile-selector-actions">
            <button className="icon-button" type="button" disabled={busy || refreshingProfileId !== null} title="新建连接配置" aria-label="新建连接配置" onClick={createProfileDraft}><Plus size={16} /></button>
            {activeProfile && (
              <>
                <button className="icon-button" type="button" disabled={busy || refreshingProfileId !== null} title={`编辑 ${activeProfile.name}`} aria-label={`编辑 ${activeProfile.name}`} onClick={() => editProfile(activeProfile)}><Pencil size={15} /></button>
                <button className="icon-button" type="button" disabled={busy || refreshingProfileId !== null} title="从远端刷新模型列表" aria-label={`刷新 ${activeProfile.name} 的模型列表`} onClick={() => refreshProfileModels(activeProfile.id)}><CloudDownload size={15} /></button>
                <button className="icon-button danger-button" type="button" disabled={busy || refreshingProfileId !== null} title={`删除 ${activeProfile.name}`} aria-label={`删除 ${activeProfile.name}`} onClick={() => deleteProfile(activeProfile)}><Trash2 size={15} /></button>
              </>
            )}
          </div>
        </div>

        {activeProfile && <div className="profile-key-status"><span>{activeProfile.has_api_key ? "API Key 已保存" : activeProfile.api_key_env ? "API Key 来自服务器环境变量" : "尚未设置 API Key"}</span><button className="secondary-button" type="button" onClick={() => editProfile(activeProfile)}>输入 / 更换 API Key</button></div>}
        {activeProfile && modelNotices[activeConnectionKey] && <p className="model-discovery-notice" role="status">{modelNotices[activeConnectionKey]}</p>}
        {activeProfile && activeEffectiveLimits ? (
          <div className="profile-budget-summary" aria-label="当前 Token 预算">
            <span>配置输入 {formatTokenLimit(activeProfile.input_token_limit)}</span>
            <span>配置输出 {formatTokenLimit(activeProfile.output_token_limit)}</span>
            {(activeEffectiveLimits.input !== activeProfile.input_token_limit || activeEffectiveLimits.output !== activeProfile.output_token_limit) && (
              <span>生效 {formatTokenLimit(activeEffectiveLimits.input)} / {formatTokenLimit(activeEffectiveLimits.output)}</span>
            )}
            {activeRemoteModel?.max_total_tokens ? <span>模型总窗 {formatTokenLimit(activeRemoteModel.max_total_tokens)}</span> : null}
            {activeRemoteModel?.supports_reasoning === true ? <span>Reasoning</span> : null}
            {activeRemoteModel?.supports_vision === true ? <span>Vision</span> : null}
          </div>
        ) : null}
        {activeProfile && activeCatalog.length ? (
          <label className="form-field profile-model-field"><span>远端模型</span><select disabled={busy || refreshingProfileId !== null} value={activeProfile.model} onChange={(event) => selectRemoteModel(activeProfile.id, event.target.value)}>{!activeCatalog.some((model) => model.id === activeProfile.model) ? <option value={activeProfile.model}>{activeProfile.model}（当前；远端未报告）</option> : null}{activeCatalog.map((model) => <option key={model.id} value={model.id}>{remoteModelLabel(model)}</option>)}</select></label>
        ) : null}
        {profileEditorOpen && (
          <div className="compact-form profile-editor">
            <div className="form-caption">
              <strong>{editingProfileId ? "编辑连接配置" : "新增连接配置"}</strong>
              <button className="icon-button" type="button" title="取消编辑" aria-label="取消编辑连接配置" onClick={resetProfileEditor}><X size={15} /></button>
            </div>
            <label className="form-field"><span>连接配置名称</span><input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
            <label className="form-field"><span>API 协议</span><select
                value={profile.provider_type}
                onChange={(event) => setProfile({ ...profile, provider_type: event.target.value as ProviderType })}
              >
                <option value="openai_responses">OpenAI Responses API</option>
                <option value="openai_chat_completions">OpenAI 兼容 Chat Completions</option>
                <option value="anthropic_messages">Anthropic Messages API</option>
              </select></label>
            <label className="form-field"><span>Base URL</span><input placeholder="https://api.example.com/v1" value={profile.base_url} onChange={(event) => setProfile({ ...profile, base_url: event.target.value })} /></label>
            <label className="form-field"><span>自定义请求路径（可选）</span><input placeholder="默认路径" value={profile.path_override} onChange={(event) => setProfile({ ...profile, path_override: event.target.value })} /></label>
            <label className="form-field"><span>模型名称</span><input list="profile-draft-models" value={profile.model} onChange={(event) => setProfile({ ...profile, model: event.target.value })} /><datalist id="profile-draft-models">{draftModels.map((item) => <option key={item.id} value={item.id}>{remoteModelLabel(item)}</option>)}</datalist></label>
            {draftModels.length > 0 && <label className="form-field"><span>模型列表</span><select value={draftModels.some((item) => item.id === profile.model) ? profile.model : ""} onChange={(event) => event.target.value && setProfile({ ...profile, model: event.target.value })}><option value="">选择模型</option>{draftModels.map((item) => <option key={item.id} value={item.id}>{remoteModelLabel(item)}</option>)}</select></label>}
            <div className="model-discovery-row"><p className="model-discovery-notice" role="status">{discoveringDraftModels ? "正在获取模型列表…" : draftModelsNotice}</p><button className="icon-button" type="button" title="重新获取模型列表" aria-label="重新获取模型列表" disabled={discoveringDraftModels} onClick={() => setDiscoveryAttempt((value) => value + 1)}><CloudDownload size={15} /></button></div>
            <label className="form-field">
              <span>API Key</span>
              <div className="secret-input">
                <div className="api-key-input-shell">
                  <input
                    aria-label="API Key"
                    type={showApiKey ? "text" : "password"}
                    autoComplete="off"
                    placeholder={editedProfile?.has_api_key ? "已保存 API Key（未显示）" : editedProfile?.api_key_env ? "使用服务器环境变量中的 Key" : "未设置 API Key，请输入"}
                    title={editedProfile?.has_api_key || editedProfile?.api_key_env ? "留空保留原 Key；输入新 Key 后保存可替换。修改协议、服务地址或请求路径时，需重新输入 Key。" : "尚未设置 API Key；输入后保存。"}
                    value={profile.api_key}
                    onChange={(event) => setProfile({ ...profile, api_key: event.target.value.trim() })}
                  />
                  {profile.api_key && <span className="api-key-unsaved" role="status" aria-label="API Key 尚未保存" title="新 API Key 尚未保存"><AlertCircle size={14} aria-hidden="true" /></span>}
                </div>
                <button className="icon-button" type="button" disabled={!profile.api_key} aria-label={showApiKey ? "隐藏本次输入的 API Key" : "显示本次输入的 API Key"} title={profile.api_key ? (showApiKey ? "隐藏本次输入" : "显示本次输入") : "只能显示本次输入；已保存的 Key 不会回传"} onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
            </label>
            <div className="profile-token-limits">
              <label className="form-field"><span>输入上下文上限</span><input type="number" min="1024" step="1024" value={profile.input_token_limit} onChange={(event) => setProfile({ ...profile, input_token_limit: Number(event.target.value) })} /><small>超限时缩减发送给模型的最旧历史，保留固定提示词和最近两条消息。</small></label>
              <label className="form-field"><span>最大输出 Token</span><input type="number" min="1" step="1024" value={profile.output_token_limit} onChange={(event) => setProfile({ ...profile, output_token_limit: Number(event.target.value) })} /><small>包含 Thinking token。</small></label>
            </div>
            {editingProfileId === activeProfile?.id && activeRemoteModel ? <small className="model-capability-note">远端报告：{activeRemoteModel.max_input_tokens ? `最大输入 ${formatTokenLimit(activeRemoteModel.max_input_tokens)}；` : ""}{activeRemoteModel.max_output_tokens ? `最大输出 ${formatTokenLimit(activeRemoteModel.max_output_tokens)}；` : ""}{activeRemoteModel.max_total_tokens ? `总上下文 ${formatTokenLimit(activeRemoteModel.max_total_tokens)}；` : ""}{!activeRemoteModel.max_input_tokens && !activeRemoteModel.max_output_tokens && !activeRemoteModel.max_total_tokens ? "未提供 Context 上限。" : "配置高于模型能力时会自动收紧生效值。"}</small> : null}
            <label className="form-field"><span>思考强度（Thinking Level）</span><select value={String(profile.default_params._thinking_level ?? "auto")} onChange={(event) => setProfile({ ...profile, default_params: { ...profile.default_params, _thinking_level: event.target.value } })}>{thinkingLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="form-field"><span>Temperature</span><input type="number" min="0" max="2" step="0.1" value={String(profile.default_params.temperature ?? "")} onChange={(event) => setProfile({ ...profile, default_params: { ...profile.default_params, temperature: event.target.value === "" ? undefined : Number(event.target.value) } })} /><small>越高越随机。</small></label>
            <button className={profileDirty ? "primary-button" : "secondary-button"} type="button" disabled={busy || refreshingProfileId !== null || !profileDirty} onClick={saveProfile}>
              {editingProfileId ? <Pencil size={15} /> : <Plus size={15} />}
              {busy ? "保存中…" : editingProfileId ? "保存修改" : "新增连接配置"}
            </button>
          </div>
        )}
      </div>
    </dialog>,
    document.body
  );
}
