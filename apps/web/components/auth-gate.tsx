"use client";

import { InvitationHint } from "@/components/invitation-hint";
import type { InvitationInfo } from "@/lib/types";
import { LanguageSwitcher, useI18n } from "@/components/i18n-provider";
import {
  Fragment,
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
import { isLocale, type Locale } from "@/lib/i18n/core";
import {
  request,
  ApiError,
  setReadCacheScope,
  invalidateReadCache,
} from "@/lib/types";
type User = {
  avatar_data?: string;
  id: string;
  name: string;
  email: string;
  color: string;
};
type Team = {
  id: string;
  name: string;
  role: string;
  display_name?: string;
};
type Me = {
  timezone: string;
  preferences: {
    locale: Locale;
    display_timezone: string;
  };
  user: User;
  teams: Team[];
  current_team: string;
  role: string;
};
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
  const { t: tr } = useI18n();
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
  const { setLocale, setTimeZone } = useI18n();
  useEffect(() => {
    if (isLocale(me?.preferences?.locale)) setLocale(me.preferences.locale);
  }, [me?.user.id, me?.preferences?.locale, setLocale]);
  useEffect(() => {
    if (me?.preferences?.display_timezone)
      setTimeZone(me.preferences.display_timezone);
  }, [me?.user.id, me?.preferences?.display_timezone, setTimeZone]);
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
      const result = await request<{
        items: AgentTokenMetadata[];
      }>("/tokens");
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
  const refreshVersion = useRef(0);
  const refresh = useCallback(async (background = false) => {
    const version = ++refreshVersion.current;
    try {
      const state = await request<{
        mode: string;
        initialized: boolean;
      }>("/auth/status");
      if (version !== refreshVersion.current) return;
      setStatus(state);
      if (state.mode !== "local-demo" && state.initialized) {
        try {
          const next = await request<Me>("/auth/me");
          if (version !== refreshVersion.current) return;
          setReadCacheScope(
            `${next.user.id}:${next.current_team}:${next.role}`,
          );
          setMe(next);
        } catch (e) {
          if (version !== refreshVersion.current) return;
          if (e instanceof ApiError && e.status === 401) {
            setReadCacheScope(null);
            setMe(null);
          } else throw e;
        }
      } else {
        setReadCacheScope(state.mode === "local-demo" ? "local-demo" : null);
        setMe(null);
      }
      setError("");
    } catch (e) {
      if (version === refreshVersion.current && !background)
        setError((e as Error).message);
    } finally {
      if (version === refreshVersion.current) setLoading(false);
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
      refreshVersion.current++;
      setReadCacheScope(null);
      setMe(null);
      setCredential("");
      setLoading(false);
    };
    const revalidate = () => {
      invalidateReadCache();
      void refresh(true);
    };
    const sessionChanged = () => {
      invalidateReadCache();
      setLoading(true);
      void refresh();
    };
    window.addEventListener("coflow:unauthorized", expired);
    window.addEventListener("coflow:session-changed", sessionChanged);
    window.addEventListener("focus", revalidate);
    return () => {
      window.removeEventListener("hashchange", readInvite);
      window.removeEventListener("coflow:unauthorized", expired);
      window.removeEventListener("coflow:session-changed", sessionChanged);
      window.removeEventListener("focus", revalidate);
      refreshVersion.current++;
      setReadCacheScope(null);
    };
  }, [refresh]);
  async function logout() {
    await request("/auth/logout", {
      method: "POST",
    });
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
      {!me && status?.mode !== "local-demo" && <LanguageSwitcher />}
      {loading ? (
        <div className="auth-loading">
          <Loader2 className="animate-spin" />
          {tr("正在连接工作空间…")}
        </div>
      ) : error ? (
        <div className="auth-loading">
          <p role="alert">{tr(error)}</p>
          <Button onClick={() => void refresh()}>{tr("重新连接")}</Button>
        </div>
      ) : status?.mode === "local-demo" ? (
        <Fragment key="local-demo">{children}</Fragment>
      ) : invite ? (
        <AccountForm
          invite={invite}
          me={me}
          initialized={!!status?.initialized}
          onDone={joined}
          onLogout={logout}
        />
      ) : me ? (
        <Fragment key={`${identity}:${me.role}`}>{children}</Fragment>
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
  const { t: tr, locale } = useI18n();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
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
    request<InvitationInfo>("/auth/invite-info", {
      method: "POST",
      body: JSON.stringify({
        token: invite,
      }),
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
          body: JSON.stringify({
            token: invite,
            name,
            password,
          }),
        });
      else
        await request(setup ? "/auth/bootstrap" : "/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email,
            name,
            password,
            team_name: team,
          }),
        });
      if (invite)
        await request("/auth/preferences", {
          method: "PATCH",
          body: JSON.stringify({ locale }),
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
        <h1>
          {invite
            ? tr("加入团队")
            : setup
              ? tr("创建你的工作空间")
              : tr("欢迎回来")}
        </h1>
        <p className="account-intro">
          {invite
            ? info
              ? tr("你受邀加入「{0}」", {
                  0: info.team_name,
                })
              : tr("正在读取邀请信息…")
            : setup
              ? tr("创建管理员账号，邀请伙伴开始协作。")
              : tr("登录后查看团队进展，继续推进协作。")}
        </p>
        {invite && info && (
          <InvitationHint info={info} className="invitation-hint" />
        )}
        {wrongAccount ? (
          <div className="info-callout">
            {tr("当前登录的是")}
            {me?.user.email}
            {tr("，此邀请属于")}
            {info?.email}。
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void onLogout()}
            >
              <LogOut />
              {tr("退出并使用受邀账号")}
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="account-form">
            {(!invite || info) && (
              <>
                <label>
                  {tr("邮箱")}
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
                    {tr("已有账号，使用原密码加入")}
                  </label>
                )}
                {(setup || (invite && !me && !existing)) && (
                  <label>
                    {tr("你的名字")}
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
                    {tr("团队名称")}
                    <input
                      required
                      maxLength={40}
                      value={team}
                      onChange={(e) => setTeam(e.target.value)}
                      placeholder={tr("如：共创团队")}
                    />
                  </label>
                )}
                {!me && (
                  <div className="account-password-group">
                    <label htmlFor="account-password">
                      {setup || (invite && !existing)
                        ? tr("设置密码")
                        : tr("密码")}
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
                        aria-label={
                          showPassword ? tr("隐藏密码") : tr("显示密码")
                        }
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
                        ? tr("至少8位，请妥善保存密码。")
                        : tr("请输入该账号的原密码。")}
                    </small>
                  </div>
                )}
                <Button type="submit" disabled={busy || (!!invite && !info)}>
                  {busy && <Loader2 className="animate-spin" />}
                  {invite
                    ? tr("接受邀请并加入")
                    : setup
                      ? tr("创建工作空间")
                      : tr("登录")}
                </Button>
              </>
            )}
          </form>
        )}
        {error && (
          <p className="account-error" role="alert">
            {tr(error)}
          </p>
        )}
        {!invite && initialized && (
          <p className="account-hint">{tr("新成员通过团队邀请链接加入。")}</p>
        )}
        {invite && (
          <a className="account-back" href="/">
            {tr("返回工作空间")}
          </a>
        )}
      </section>
      <p className="account-footer">{tr("AI 时代的工作协作方式")}</p>
    </main>
  );
}
