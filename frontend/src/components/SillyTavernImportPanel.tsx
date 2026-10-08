import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api, APIProfile, SillyTavernImportReport } from "../lib/api";
import { CollapsibleSection } from "./CollapsibleSection";

const labels: Record<string, string> = {
  character: "角色卡", worldbook: "世界书", profile: "可用 API 配置",
  credential: "保存的凭据", prompt: "提示词预设", persona: "用户角色",
  regex: "正则规则", settings: "原始设置", archive: "暂不支持的配置",
  connection: "未转换的连接配置"
};

export function SillyTavernImportPanel({ profiles, onChanged, onError }: {
  profiles: APIProfile[]; onChanged: () => Promise<void>; onError?: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [sshHost, setSshHost] = useState("oc");
  const [directory, setDirectory] = useState("~/SillyTavern");
  const [user, setUser] = useState("default-user");
  const [activate, setActivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SillyTavernImportReport | null>(null);
  const [kind, setKind] = useState("connection");
  const [viewId, setViewId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const resources = useQuery({ queryKey: ["imported-resources", kind], queryFn: () => api.importedResources(kind) });
  const credentials = useQuery({ queryKey: ["saved-credentials"], queryFn: api.savedCredentials });
  const viewed = resources.data?.find((item) => item.id === viewId);
  const detail = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

  async function preview() {
    setBusy(true);
    setReport(null);
    onError?.("");
    try {
      setReport(await api.previewSillyTavern({ ssh_host: sshHost, directory, user }));
    } catch (cause) {
      onError?.("SillyTavern 预览失败：" + detail(cause));
    } finally { setBusy(false); }
  }

  async function apply() {
    if (!report?.token) return;
    setBusy(true);
    onError?.("");
    try {
      const saved = await api.applySillyTavern(report.token, activate);
      setReport(saved);
      await queryClient.invalidateQueries();
      await onChanged();
    } catch (cause) {
      // Server consumes a preview once; allow a fresh preview after failure.
      setReport((current) => current ? { ...current, token: null } : null);
      onError?.("SillyTavern 导入失败：" + detail(cause));
    } finally { setBusy(false); }
  }

  async function bind() {
    if (!profileId || !credentialId) return;
    setBusy(true);
    try {
      await api.bindCredential(profileId, credentialId);
      await onChanged();
      onError?.("");
    } catch (cause) { onError?.("应用保存的密钥失败：" + detail(cause)); }
    finally { setBusy(false); }
  }

  function editSource(setter: (value: string) => void, value: string) {
    setter(value);
    setReport(null);
  }

  return <CollapsibleSection contentId="sidebar-sillytavern-import-content" title="SillyTavern 导入"
    icon={<Download size={16} />} storageKey="yggdrasil-tavern.sidebar.sillytavern-import.expanded">
    <p className="section-help">通过运行 Yggdrasil 后端的电脑上配置的 SSH 别名读取远端酒馆。先预览，再备份本地数据库并导入。</p>
    <label className="form-field"><span>SSH 主机</span><input disabled={busy} value={sshHost} onChange={(e) => editSource(setSshHost, e.target.value)} /></label>
    <label className="form-field"><span>SillyTavern 目录</span><input disabled={busy} value={directory} onChange={(e) => editSource(setDirectory, e.target.value)} /></label>
    <label className="form-field"><span>用户目录</span><input disabled={busy} value={user} onChange={(e) => editSource(setUser, e.target.value)} /></label>
    <button className="secondary-button full-button" disabled={busy || !sshHost || !directory || !user} onClick={preview}>{busy ? "处理中…" : "预览远端配置"}</button>
    {report && <div className="st-import-report" role="status">
      <p>{report.created && Object.keys(report.created).length ? "导入完成" : report.token ? "预览完成，尚未写入" : report.errors.length ? "预览发现错误" : "没有新增内容"}</p>
      <ul>{Object.entries(report.counts).map(([key, count]) => <li key={key}>{labels[key] || key}：{count}；已导入 {report.already_imported[key] || 0}{report.created?.[key] ? `；本次新增 ${report.created[key]}` : ""}</li>)}</ul>
      {report.errors.map((error, i) => <p className="field-error" key={i}>{error}</p>)}
      {report.warnings.length > 0 && <details><summary>转换限制（{report.warnings.length}）</summary><ul>{report.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
      <details><summary>未导入的目录和文件</summary><p className="section-help">聊天记录、群聊运行方式、图片资源及插件代码没有转成 Yggdrasil 会话或功能。</p><pre>{JSON.stringify(report.omitted, null, 2)}</pre></details>
      {report.backup_path && <p className="section-help">数据库备份：{report.backup_path}</p>}
      {report.token && <>
        <label className="form-field"><span><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />启用远端当前提示词与新会话默认设置</span><small>会替换所有会话共用的提示词；新会话使用导入的用户名、世界书和当前连接。</small></label>
        <button className="primary-button full-button" disabled={busy || !report.can_apply} onClick={apply}>备份并导入</button>
      </>}
    </div>}
    <hr />
    <label className="form-field"><span>查看已保存的配置</span><select value={kind} onChange={(e) => { setKind(e.target.value); setViewId(""); }}>
      <option value="connection">未转换的连接配置</option><option value="persona">用户角色</option><option value="regex">正则规则</option><option value="settings">原始设置</option><option value="archive">暂不支持的配置</option>
    </select></label>
    <label className="form-field"><span>配置名称</span><select value={viewId} onChange={(e) => setViewId(e.target.value)}><option value="">选择配置</option>{resources.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {resources.error && <p className="field-error">配置读取失败：{detail(resources.error)}</p>}
    {viewed && <details open><summary>{viewed.name}</summary>{viewed.warnings.map((warning, i) => <p className="section-help" key={i}>{warning}</p>)}<pre>{JSON.stringify(viewed.raw_json, null, 2)}</pre></details>}
    <label className="form-field"><span>给 API 配置更换保存的密钥</span><select value={profileId} onChange={(e) => setProfileId(e.target.value)}><option value="">选择 API 配置</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label>
    <label className="form-field"><span>保存的 API Key</span><select value={credentialId} onChange={(e) => setCredentialId(e.target.value)}><option value="">选择密钥；不会显示明文</option>{credentials.data?.filter((item) => item.secret_type.startsWith("api_key_")).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {credentials.error && <p className="field-error">密钥列表读取失败：{detail(credentials.error)}</p>}
    <button className="secondary-button full-button" disabled={busy || !profileId || !credentialId} onClick={bind}>应用到所选 API 配置</button>
  </CollapsibleSection>;
}
