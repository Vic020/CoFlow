"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { Eye, EyeOff, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoFlowLogo } from "@/components/coflow-logo";
import { WorkspaceOnboarding } from "@/components/workspace-onboarding";
import {
  hasActiveReportToken,
  type AgentTokenMetadata,
} from "@/lib/report-prompt";
import { request, ApiError } from "@/lib/types";

type User = { id: string; name: string; email: string; color: string };
type Team = { id: string; name: string; role: string; display_name?: string };
type Me = { user: User; teams: Team[]; current_team: string; role: string };
type TokenStatus = "loading" | "available" | "missing" | "error";
type AuthValue = {
  mode: string;
  me: Me | null;
  credential: string;
  setCredential: (s: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  tokenStatus: TokenStatus;
  refreshTokens: () => Promise<void>;
};
const AuthContext = createContext<AuthValue | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthGate is required");
  return value;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<{
    mode: string;
    initialized: boolean;
  } | null>(null);
  const [me, setMe] = useState<Me | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [credential, setCredential] = useState("");
  const [invite, setInvite] = useState("");
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>("loading");
  const identity = `${me?.current_team || ""}:${me?.user.id || ""}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const refreshTokens = useCallback(async () => {
    if (!me) {
      setTokenStatus("missing");
      return;
    }
    const target = `${me.current_team}:${me.user.id}`;
    try {
      const result = await request<{ items: AgentTokenMetadata[] }>("/tokens");
      if (currentIdentity.current !== target) return;
      setTokenStatus(
        hasActiveReportToken(result.items) ? "available" : "missing",
      );
    } catch {
      if (currentIdentity.current === target) setTokenStatus("error");
    }
  }, [me?.current_team, me?.user.id]);
  useEffect(() => {
    setTokenStatus("loading");
    void refreshTokens();
    const timer = setInterval(() => void refreshTokens(), 30000);
    return () => clearInterval(timer);
  }, [refreshTokens]);
  const refresh = useCallback(async () => {
    try {
      const state = await request<{ mode: string; initialized: boolean }>(
        "/auth/status",
      );
      setStatus(state);
      if (state.mode !== "local-demo" && state.initialized) {
        try {
          setMe(await request<Me>("/auth/me"));
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) setMe(null);
          else throw e;
        }
      } else setMe(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const readInvite = () =>
      setInvite(
        new URLSearchParams(window.location.hash.slice(1)).get("invite") || "",
      );
    readInvite();
    void refresh();
    window.addEventListener("hashchange", readInvite);
    const expired = () => {
      setMe(null);
      setCredential("");
    };
    window.addEventListener("coflow:unauthorized", expired);
    return () => {
      window.removeEventListener("hashchange", readInvite);
      window.removeEventListener("coflow:unauthorized", expired);
    };
  }, [refresh]);
  async function logout() {
    await request("/auth/logout", { method: "POST" });
    setCredential("");
    setMe(null);
  }
  useEffect(() => setCredential(""), [me?.user.id, me?.current_team]);
  const value = {
    mode: status?.mode || "team",
    me,
    credential,
    setCredential,
    refresh,
    logout,
    tokenStatus,
    refreshTokens,
  };
  function joined() {
    setInvite("");
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    void refresh();
  }
  return (
    <AuthContext.Provider value={value}>
      {loading ? (
        <div className="auth-loading">
          <Loader2 className="animate-spin" />
          正在连接工作空间…
        </div>
      ) : error ? (
        <div className="auth-loading">
          <p role="alert">{error}</p>
          <Button onClick={() => void refresh()}>重新连接</Button>
        </div>
      ) : status?.mode === "local-demo" ? (
        children
      ) : invite ? (
        <AccountForm
          invite={invite}
          me={me}
          initialized={!!status?.initialized}
          onDone={joined}
          onLogout={logout}
        />
      ) : me ? (
        children
      ) : (
        <AccountForm
          invite=""
          me={null}
          initialized={!!status?.initialized}
          onDone={() => void refresh()}
          onLogout={logout}
        />
      )}
    </AuthContext.Provider>
  );
}

function AccountForm({
  invite,
  me,
  initialized,
  onDone,
  onLogout,
}: {
  invite: string;
  me: Me | null;
  initialized: boolean;
  onDone: () => void;
  onLogout: () => Promise<void>;
}) {
  const [info, setInfo] = useState<{ email: string; team_name: string } | null>(
    null,
  );
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [team, setTeam] = useState("");
  const [existing, setExisting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    if (!invite) return;
    setInfo(null);
    setError("");
    request<{ email: string; team_name: string }>("/auth/invite-info", {
      method: "POST",
      body: JSON.stringify({ token: invite }),
    })
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, [invite]);
  const setup = !initialized && !invite;
  const wrongAccount = !!me && !!info && me.user.email !== info.email;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (invite)
        await request("/auth/accept-invite", {
          method: "POST",
          body: JSON.stringify({ token: invite, name, password }),
        });
      else
        await request(setup ? "/auth/bootstrap" : "/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, name, password, team_name: team }),
        });
      setPassword("");
      setShowPassword(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (setup) return <WorkspaceOnboarding onDone={onDone} />;
  return (
    <main className="account-page">
      <div className="account-brand">
        <CoFlowLogo />
        <strong>CoFlow</strong>
      </div>
      <section className="account-card">
        <span className="eyebrow">WORK TOGETHER WITH AGENTS</span>
        <h1>{invite ? "加入团队" : setup ? "创建你的工作空间" : "欢迎回来"}</h1>
        <p className="account-intro">
          {invite
            ? info
              ? `你受邀加入「${info.team_name}」`
              : "正在读取邀请信息…"
            : setup
              ? "创建管理员账号，邀请伙伴开始协作。"
              : "登录后查看团队进展，继续推进协作。"}
        </p>
        {wrongAccount ? (
          <div className="info-callout">
            当前登录的是 {me?.user.email}，此邀请属于 {info?.email}。
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void onLogout()}
            >
              <LogOut />
              退出并使用受邀账号
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="account-form">
            {(!invite || info) && (
              <>
                <label>
                  邮箱
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    value={info?.email || email}
                    readOnly={!!invite}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                {invite && !me && (
                  <label className="account-existing">
                    <input
                      type="checkbox"
                      checked={existing}
                      onChange={(e) => setExisting(e.target.checked)}
                    />
                    已有账号，使用原密码加入
                  </label>
                )}
                {(setup || (invite && !me && !existing)) && (
                  <label>
                    你的名字
                    <input
                      required
                      maxLength={40}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                    />
                  </label>
                )}
                {setup && (
                  <label>
                    团队名称
                    <input
                      required
                      maxLength={40}
                      value={team}
                      onChange={(e) => setTeam(e.target.value)}
                      placeholder="如：共创团队"
                    />
                  </label>
                )}
                {!me && (
                  <div className="account-password-group">
                    <label htmlFor="account-password">
                      {setup || (invite && !existing) ? "设置密码" : "密码"}
                    </label>
                    <span className="account-password-field">
                      <input
                        id="account-password"
                        aria-describedby="account-password-hint"
                        type={showPassword ? "text" : "password"}
                        required
                        minLength={8}
                        maxLength={72}
                        autoComplete={
                          setup || (invite && !existing)
                            ? "new-password"
                            : "current-password"
                        }
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="account-password-toggle"
                        aria-label={showPassword ? "隐藏密码" : "显示密码"}
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword((visible) => !visible)}
                      >
                        {showPassword ? (
                          <EyeOff aria-hidden="true" />
                        ) : (
                          <Eye aria-hidden="true" />
                        )}
                      </button>
                    </span>
                    <small id="account-password-hint">
                      {setup || (invite && !existing)
                        ? "至少8位，请妥善保存密码。"
                        : "请输入该账号的原密码。"}
                    </small>
                  </div>
                )}
                <Button type="submit" disabled={busy || (!!invite && !info)}>
                  {busy && <Loader2 className="animate-spin" />}
                  {invite ? "接受邀请并加入" : setup ? "创建工作空间" : "登录"}
                </Button>
              </>
            )}
          </form>
        )}
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        {!invite && initialized && (
          <p className="account-hint">新成员通过团队邀请链接加入。</p>
        )}
        {invite && (
          <a className="account-back" href="/">
            返回工作空间
          </a>
        )}
      </section>
      <p className="account-footer">AI 时代的工作协作方式</p>
    </main>
  );
}
