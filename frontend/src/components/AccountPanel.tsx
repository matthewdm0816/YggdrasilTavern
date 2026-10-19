import { FormEvent, useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { api, UserProfile } from "../lib/api";
import { useAccount } from "./AccountContext";
import { CollapsibleSection } from "./CollapsibleSection";

export function AccountPanel() {
  const account = useAccount();
  const [displayName, setDisplayName] = useState(account?.status.user?.display_name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [resetId, setResetId] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const user = account?.status.user;

  useEffect(() => { setDisplayName(user?.display_name || ""); }, [user?.display_name]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setNotice("");
    try { await action(); }
    catch (cause) {
      console.error("用户资料或账号操作失败", cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  if (!account) return null;

  function create(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const payload = { username, password: newPassword, display_name: newDisplayName };
      if (!account!.status.enabled) {
        account!.updateStatus(await api.setupAccounts(payload));
      } else {
        await api.createUser(payload);
        setUsers(await api.users());
        setNotice("新用户已创建。新用户登录后拥有独立的空白资料。");
      }
      setUsername(""); setNewPassword(""); setNewDisplayName("");
    });
  }

  return <CollapsibleSection contentId="account-settings-content" title="用户资料与登录" icon={<UserRound size={16} />} storageKey="yggdrasil-tavern.account.expanded" defaultExpanded>
    <div className="account-panel">
      {user ? <>
        <p>当前用户：<strong>{user.display_name}</strong>（{user.username}） · {user.is_admin ? "管理员" : "普通用户"}</p>
        <p className="muted">角色、会话、模型与 API 设置、世界书和提示词均保存在此账号的独立资料中。</p>
        <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
          const updated = await api.updateUserProfile(displayName);
          account.updateStatus({ ...account.status, user: updated }); setNotice("个人资料已保存。");
        }); }}>
          <label className="form-field"><span>显示名称</span><input value={displayName} maxLength={120} required onChange={(event) => setDisplayName(event.target.value)} /></label>
          <button type="submit" className="secondary-button" disabled={busy}>保存个人资料</button>
        </form>
        <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
          account.updateStatus(await api.changePassword(currentPassword, password));
          setCurrentPassword(""); setPassword(""); setNotice("密码已修改，其他登录会话已退出。");
        }); }}>
          <label className="form-field"><span>当前密码</span><input type="password" autoComplete="current-password" required maxLength={1024} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label className="form-field"><span>新密码（至少 12 个字符）</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button type="submit" className="secondary-button" disabled={busy}>修改密码</button>
        </form>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(account.logout)}>退出登录 / 切换账号</button>
      </> : <p>当前使用本地单用户模式。启用多用户登录后，现有数据归首位管理员所有，其他用户从空白资料开始。</p>}

      {(user?.is_admin || account.status.can_setup) && <>
        <h3>{user ? "创建用户" : "启用多用户登录"}</h3>
        <form onSubmit={create}>
          <label className="form-field"><span>{user ? "新用户的用户名" : "管理员用户名"}</span><input autoComplete="off" required maxLength={80} value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="form-field"><span>{user ? "新用户的显示名称" : "管理员显示名称"}</span><input maxLength={120} value={newDisplayName} onChange={(event) => setNewDisplayName(event.target.value)} /></label>
          <label className="form-field"><span>{user ? "新用户的密码（至少 12 个字符）" : "管理员密码（至少 12 个字符）"}</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <button type="submit" className="primary-button" disabled={busy}>{user ? "创建独立用户" : "启用并登录管理员"}</button>
        </form>
      </>}

      {user?.is_admin && <>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => setUsers(await api.users()))}>查看 / 刷新用户列表</button>
        <ul className="account-user-list">{users.map((item) => <li key={item.id}>
          <span>{item.display_name}（{item.username}） · {item.active ? "已启用" : "已停用"}{item.is_admin ? " · 管理员" : ""}</span>
          {!item.is_owner && <div className="inline-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void run(async () => {
              await api.updateUser(item.id, { active: !item.active }); setUsers(await api.users());
              setNotice(item.active ? "用户已停用，登录会话已退出；该用户的数据仍然保留。" : "用户已启用。");
            })}>{item.active ? "停用" : "启用"}</button>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => { setResetId(item.id); setResetPassword(""); }}>重设密码</button>
          </div>}
        </li>)}</ul>
        {resetId && <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
          await api.updateUser(resetId, { password: resetPassword });
          setResetId(""); setResetPassword(""); setNotice("密码已重设，该用户的登录会话已退出。");
        }); }}>
          <label className="form-field"><span>为 {users.find((item) => item.id === resetId)?.username} 设置新密码</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label>
          <button className="secondary-button" type="submit" disabled={busy}>保存新密码</button>
          <button className="secondary-button" type="button" onClick={() => { setResetId(""); setResetPassword(""); }}>取消</button>
        </form>}
      </>}
      {notice && <p role="status">{notice}</p>}
      {account.statusError && <p className="field-error" role="alert">无法检查登录状态：{account.statusError}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  </CollapsibleSection>;
}
