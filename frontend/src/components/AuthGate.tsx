import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { LockKeyhole, LogIn, RefreshCw, ShieldCheck, WifiOff } from "lucide-react";
import { api, AUTH_REQUIRED_EVENT, AuthStatus } from "../lib/api";

type Props = {
  children: ReactNode;
};

type GatePhase = "checking" | "login" | "ready" | "error";

export function authAllowsApplication(status: AuthStatus): boolean {
  return !status.enabled || status.authenticated;
}

export function readableAuthError(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (/invalid username or password/i.test(detail)) return "用户名或密码错误。";
  if (/failed to fetch|networkerror|network request failed/i.test(detail)) {
    return "无法连接到 YggdrasilTavern 服务，请确认后端已经启动且网络可达。";
  }
  return detail || "发生了未知错误。";
}

export function AuthGate({ children }: Props) {
  const [phase, setPhase] = useState<GatePhase>("checking");
  const [checkError, setCheckError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestRevisionRef = useRef(0);

  const checkStatus = useCallback(async () => {
    const revision = ++requestRevisionRef.current;
    setPhase("checking");
    setCheckError(null);
    try {
      const status = await api.authStatus();
      if (revision !== requestRevisionRef.current) return;
      setPhase(authAllowsApplication(status) ? "ready" : "login");
    } catch (cause) {
      if (revision !== requestRevisionRef.current) return;
      setCheckError(readableAuthError(cause));
      setPhase("error");
      console.error("鉴权状态检查失败", cause);
    }
  }, []);

  useEffect(() => {
    void checkStatus();
    return () => {
      requestRevisionRef.current += 1;
    };
  }, [checkStatus]);

  useEffect(() => {
    function requireLogin() {
      requestRevisionRef.current += 1;
      setPassword("");
      setLoginError("登录会话已过期，请重新登录。");
      setPhase("login");
    }

    window.addEventListener(AUTH_REQUIRED_EVENT, requireLogin);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, requireLogin);
  }, []);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setLoginError("请输入用户名和密码。");
      return;
    }

    setSubmitting(true);
    setLoginError(null);
    try {
      const status = await api.authLogin({ username: normalizedUsername, password });
      if (!authAllowsApplication(status)) {
        throw new Error("服务器没有确认登录状态，请重试。");
      }
      setPassword("");
      setPhase("ready");
    } catch (cause) {
      setPassword("");
      setLoginError(readableAuthError(cause));
      console.error("登录失败", cause);
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "ready") {
    return <>{children}</>;
  }

  return (
    <main className="auth-gate" aria-busy={phase === "checking" || submitting}>
      <section className="auth-card" aria-labelledby="auth-title">
        <header className="auth-brand">
          <span className="auth-brand-icon" aria-hidden="true">
            {phase === "error" ? <WifiOff size={26} /> : phase === "login" ? <LockKeyhole size={26} /> : <ShieldCheck size={26} />}
          </span>
          <div>
            <p className="eyebrow">YggdrasilTavern</p>
            <h1 id="auth-title">{phase === "login" ? "登录酒馆" : phase === "error" ? "无法验证访问权限" : "正在验证访问权限"}</h1>
          </div>
        </header>

        {phase === "checking" && (
          <div className="auth-status-copy" role="status">
            <RefreshCw className="auth-spinner" size={20} aria-hidden="true" />
            <p>正在连接后端并检查当前会话…</p>
          </div>
        )}

        {phase === "error" && (
          <div className="auth-status-copy">
            <p className="auth-error" role="alert">状态检查失败：{checkError}</p>
            <button className="secondary-button auth-retry" type="button" onClick={() => void checkStatus()}>
              <RefreshCw size={16} />重新检查
            </button>
          </div>
        )}

        {phase === "login" && (
          <>

            <form className="auth-form" onSubmit={submitLogin}>
              <label className="auth-field">
                <span>用户名</span>
                <input
                  autoFocus
                  autoComplete="username"
                  inputMode="text"
                  value={username}
                  disabled={submitting}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label className="auth-field">
                <span>密码</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={submitting}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {loginError && <p className="auth-error" role="alert">登录失败：{loginError}</p>}
              <button className="primary-button auth-submit" type="submit" disabled={submitting || !username.trim() || !password}>
                <LogIn size={17} />{submitting ? "正在登录…" : "登录"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
