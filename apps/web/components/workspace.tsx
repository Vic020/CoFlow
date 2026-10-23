"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownWideNarrow,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  Filter,
  Link2,
  Loader2,
  Menu,
  MessageCircle,
  Plus,
  ChevronLeft,
  Search,
  Settings2,
  KeyRound,
  Pencil,
  Users,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { ReportCompose } from "@/components/report-compose";
import { ReportHub, type ReportTab } from "@/components/report-hub";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { TeamSwitcher } from "@/components/team-switcher";
import { WorkspaceOnboarding } from "@/components/workspace-onboarding";
import { TokenManager } from "@/components/token-manager";
import { TeamSettings } from "@/components/team-settings";
import { AgentConnectCard } from "@/components/agent-connect-card";
import { NotificationCenter } from "@/components/notification-center";
import { AccountMenu } from "@/components/account-menu";
import { CatalogManager } from "@/components/catalog-manager";
import { ClassificationEditor } from "@/components/catalog-manager";
import {
  CollaborationPanel,
  ReportHistory,
} from "@/components/collaboration-panel";
import { useAuth } from "@/components/auth-gate";
import { CoFlowLogo } from "@/components/coflow-logo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collaboration,
  reportDomains,
  clock,
  dateKey,
  Meta,
  Report,
  Member,
  request,
  statuses,
} from "@/lib/types";

type Filters = {
  project: string;
  domain: string;
  member: string;
  agent: string;
  days: string;
};
const initialFilters: Filters = {
  project: "",
  domain: "",
  member: "",
  agent: "",
  days: "7",
};
function Avatar({
  member,
  small = false,
}: {
  member?: Member;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${member?.color || "mint"} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      {member?.name.slice(0, 1) || "?"}
    </span>
  );
}
function Agent({ name }: { name: string }) {
  return (
    <span className="agent">
      <span className={name.includes("Claude") ? "claude-mark" : "codex-mark"}>
        {name.includes("Claude") ? "✳" : "◉"}
      </span>
      {name || "手动上报"}
    </span>
  );
}
function Status({ value }: { value: string }) {
  const s = statuses[value] || statuses.progress;
  return (
    <span className={`status ${s.className}`}>
      <i />
      {s.label}
    </span>
  );
}
function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  options: { id: string; name: string }[];
}) {
  return (
    <label className="filter-select">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">全部</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} />
    </label>
  );
}
function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function Workspace({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const credentialsPage = pathname === "/credentials";
  const settingsPage = pathname === "/settings";
  const newTeamPage = pathname === "/teams/new";
  const auth = useAuth();
  const activeTeam = useRef(auth.me?.current_team);
  activeTeam.current = auth.me?.current_team;
  const loadVersion = useRef(0);
  const [collaborations, setCollaborations] = useState<Collaboration[]>([]);
  const [scope, setScope] = useState<"all" | "related" | "todo">("all");
  const [meta, setMeta] = useState<Meta | null>(null),
    [reports, setReports] = useState<Report[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters),
    [query, setQuery] = useState(""),
    [view, setView] = useState("all"),
    [unread, setUnread] = useState(false);
  const [seen, setSeen] = useState<Record<string, string>>({}),
    [detail, setDetail] = useState<string | null>(null),
    [reportTab, setReportTab] = useState<ReportTab | null>(null),
    [nav, setNav] = useState(false),
    [mobileFilters, setMobileFilters] = useState(false),
    [attention, setAttention] = useState(false),
    [onlyAttention, setOnlyAttention] = useState(false),
    [notice, setNotice] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  function toggleSidebar() {
    setSidebarCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem("coflow-sidebar-collapsed", String(next));
      } catch {}
      return next;
    });
  }
  const load = useCallback(
    async (initial = false) => {
      const team = auth.me?.current_team;
      const version = ++loadVersion.current;
      const current = () =>
        team === activeTeam.current && version === loadVersion.current;
      if (initial) setLoading(true);
      try {
        const [m, r] = await Promise.all([
          request<Meta>("/meta"),
          request<{ items: Report[] }>("/reports"),
        ]);
        if (m.mode !== "local-demo") {
          const [reads, cs] = await Promise.all([
            request<{ items: Record<string, string> }>("/reads"),
            request<{ items: Collaboration[] }>("/collaborations"),
          ]);
          if (!current()) return;
          setSeen(reads.items);
          setCollaborations(cs.items);
        } else {
          setCollaborations([]);
        }
        if (!current()) return;
        setMeta(m);
        setReports(r.items);
        setError("");
      } catch (e) {
        if (current()) setError((e as Error).message);
      } finally {
        if (current()) setLoading(false);
      }
    },
    [auth.me?.current_team],
  );
  useEffect(() => {
    setFilters(initialFilters);
    setScope("all");
    setUnread(false);
    setDetail(null);
    setCatalogOpen(false);
    setSeen({});
    setReports([]);
    setMeta(null);
    void load(true);
    try {
      if (auth.mode === "local-demo")
        setSeen(JSON.parse(localStorage.getItem("coflow-seen") || "{}"));
      setSidebarCollapsed(
        localStorage.getItem("coflow-sidebar-collapsed") === "true",
      );
    } catch {}
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  const member = (id: string) => meta?.members.find((m) => m.id === id);
  const project = (id: string) => meta?.projects.find((p) => p.id === id);
  const markRead = (r: Report) => {
    setDetail(r.id);
    if (meta?.mode !== "local-demo")
      void request(`/reports/${r.id}/read`, {
        method: "POST",
        body: JSON.stringify({ seen_at: r.updated_at }),
      }).catch((e) => setNotice(`已读同步失败：${e.message}`));
    setSeen((prev) => {
      const next = { ...prev, [r.id]: r.updated_at };
      if (meta?.mode === "local-demo")
        localStorage.setItem("coflow-seen", JSON.stringify(next));
      return next;
    });
  };
  const updateFilter = (key: keyof Filters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));
  function resetFilters() {
    setFilters(initialFilters);
    setScope("all");
    setUnread(false);
    setOnlyAttention(false);
    setQuery("");
  }
  const needs = reports.filter(
    (r) => r.status === "blocked" || r.status === "review",
  );
  const filtered = useMemo(() => {
    const cutoff = filters.days
      ? Date.now() - Number(filters.days) * 86400000
      : 0;
    return reports.filter(
      (r) =>
        (!filters.project || r.project_id === filters.project) &&
        (!filters.domain || reportDomains(r).includes(filters.domain)) &&
        (!filters.member || r.author_id === filters.member) &&
        (!filters.agent || r.agent === filters.agent) &&
        new Date(r.created_at).getTime() >= cutoff &&
        (scope !== "related" ||
          r.author_id === meta?.current_user ||
          r.mentions.includes(meta?.current_user || "") ||
          r.comments.some((c) => c.author_id === meta?.current_user) ||
          collaborations.some(
            (c) =>
              c.report_id === r.id &&
              (c.author_id === meta?.current_user ||
                c.assignee_id === meta?.current_user),
          )) &&
        (!unread ||
          !seen[r.id] ||
          Date.parse(seen[r.id]) < Date.parse(r.updated_at)) &&
        (!onlyAttention || ["blocked", "review"].includes(r.status)) &&
        (scope !== "todo" ||
          collaborations.some(
            (c) =>
              c.report_id === r.id &&
              !["done", "cancelled"].includes(c.status) &&
              c.assignee_id === meta?.current_user,
          )) &&
        (!query ||
          [
            r.title,
            r.body,
            r.agent,
            reportDomains(r).join(" "),
            meta?.members.find((m) => m.id === r.author_id)?.name,
            meta?.projects.find((p) => p.id === r.project_id)?.name,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase())),
    );
  }, [
    reports,
    filters,
    scope,
    unread,
    seen,
    query,
    meta,
    onlyAttention,
    collaborations,
  ]);
  const groups = useMemo(() => {
    const map = new Map<string, Report[]>();
    for (const r of filtered) {
      const key = dateKey(r.created_at);
      map.set(key, [...(map.get(key) || []), r]);
    }
    return [...map.entries()];
  }, [filtered]);
  const selected = reports.find((r) => r.id === detail);
  const today = dateKey(new Date().toISOString());
  const dayLabel = (key: string) => {
    const d = new Date(`${key}T12:00:00+08:00`);
    const month = d.getUTCMonth() + 1,
      day = d.getUTCDate();
    const yesterday = dateKey(new Date(Date.now() - 86400000).toISOString());
    return `${key === today ? "今天 · " : key === yesterday ? "昨天 · " : ""}${month}月${day}日`;
  };
  const activeFilters =
    Object.entries(filters).filter(
      ([k, v]) => v !== initialFilters[k as keyof Filters],
    ).length +
    Number(scope !== "all") +
    Number(unread);
  const pendingCount = collaborations.filter(
    (c) =>
      c.assignee_id === meta?.current_user &&
      !["done", "cancelled"].includes(c.status),
  ).length;
  const domainFilter = (
    <SelectFilter
      label="领域"
      value={filters.domain}
      onChange={(v) => updateFilter("domain", v)}
      options={(meta?.domains || []).map((d) => ({ id: d, name: d }))}
    />
  );
  const filtersContent = (
    <>
      <SelectFilter
        label="项目"
        value={filters.project}
        onChange={(v) => updateFilter("project", v)}
        options={meta?.projects || []}
      />
      <SelectFilter
        label="成员"
        value={filters.member}
        onChange={(v) => updateFilter("member", v)}
        options={meta?.members || []}
      />
      <SelectFilter
        label="Agent"
        value={filters.agent}
        onChange={(v) => updateFilter("agent", v)}
        options={[...new Set(reports.map((r) => r.agent).filter(Boolean))].map(
          (a) => ({ id: a, name: a }),
        )}
      />
      <label className="filter-select">
        <span>日期</span>
        <select
          aria-label="日期"
          value={filters.days}
          onChange={(e) => updateFilter("days", e.target.value)}
        >
          <option value="1">最近 24 小时</option>
          <option value="7">最近 7 天</option>
          <option value="30">最近 30 天</option>
          <option value="">全部时间</option>
        </select>
        <ChevronDown size={14} />
      </label>
      <div className="filter-personal">
        <div className="scope-shortcuts" role="group" aria-label="动态范围">
          <button
            type="button"
            aria-pressed={scope === "all"}
            title="团队全部动态"
            onClick={() => setScope("all")}
          >
            全部
          </button>
          <button
            type="button"
            aria-pressed={scope === "related"}
            title="我发布、评论、被提及或参与协作的动态"
            onClick={() => setScope("related")}
          >
            与我相关
          </button>
          {meta?.mode !== "local-demo" && (
            <button
              type="button"
              aria-pressed={scope === "todo"}
              title="分配给我且尚未完成的协作"
              onClick={() => setScope("todo")}
            >
              待我处理 <span>{pendingCount}</span>
            </button>
          )}
        </div>
        <label className="filter-unread">
          <input
            type="checkbox"
            checked={unread}
            onChange={(e) => setUnread(e.target.checked)}
          />
          未读
        </label>
      </div>
    </>
  );
  const navigation = (
    <>
      <div className="brand-row">
        {sidebarCollapsed && !nav ? (
          <button
            className="brand brand-expand"
            aria-label="点击 Logo 展开侧边栏"
            title="展开侧边栏"
            aria-expanded={false}
            onClick={toggleSidebar}
          >
            <CoFlowLogo />
          </button>
        ) : (
          <div className="brand">
            <CoFlowLogo />
            <span>CoFlow</span>
          </div>
        )}
        {!sidebarCollapsed && (
          <Button
            className="sidebar-toggle"
            variant="ghost"
            size="icon"
            aria-label="收起侧边栏"
            title="收起侧边栏"
            aria-expanded={true}
            onClick={toggleSidebar}
          >
            <ChevronLeft />
          </Button>
        )}
      </div>
      <TeamSwitcher
        teamName={
          meta?.team.name ||
          auth.me?.teams.find((t) => t.id === auth.me?.current_team)?.name ||
          "工作空间"
        }
        onNavigate={() => setNav(false)}
      />
      <nav>
        <Link
          href="/"
          className={!credentialsPage && !settingsPage ? "nav-active" : ""}
          aria-current={!credentialsPage && !settingsPage ? "page" : undefined}
          aria-label="Timeline"
          title="Timeline"
          onClick={() => setNav(false)}
        >
          <Clock3 size={18} />
          <span className="nav-label">Timeline</span>
        </Link>
      </nav>
      <div className="nav-bottom">
        <Link
          href="/credentials"
          aria-label="Agent 凭证"
          title="Agent 凭证"
          className={credentialsPage ? "nav-active" : ""}
          aria-current={credentialsPage ? "page" : undefined}
          onClick={() => setNav(false)}
        >
          <KeyRound size={18} />
          <span className="nav-label">Agent 凭证</span>
        </Link>
        <Link
          href="/settings"
          aria-label="团队设置"
          title="团队设置"
          className={settingsPage ? "nav-active" : ""}
          aria-current={settingsPage ? "page" : undefined}
          onClick={() => setNav(false)}
        >
          <Settings2 size={18} />
          <span className="nav-label">团队设置</span>
        </Link>
        <AccountMenu
          avatar={<Avatar member={member(meta?.current_user || "")} small />}
          name={
            member(meta?.current_user || "")?.name ||
            auth.me?.user.name ||
            "成员"
          }
          role={
            auth.mode === "local-demo"
              ? "本地演示身份"
              : meta?.role === "admin"
                ? "团队管理员"
                : "团队成员"
          }
        />
      </div>
    </>
  );
  if (newTeamPage)
    return (
      <>
        {children}
        <WorkspaceOnboarding
          onDone={() => router.push("/")}
          initialName={auth.me?.user.name}
          onCreateTeam={async (teamName, displayName) => {
            await request("/teams", {
              method: "POST",
              body: JSON.stringify({
                name: teamName,
                display_name: displayName,
              }),
            });
            auth.setCredential("");
            await auth.refresh();
          }}
        />
      </>
    );
  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      {children}
      <aside className="sidebar">{navigation}</aside>
      <main className="main-shell">
        <div
          className={`workspace-content${credentialsPage || settingsPage ? " credentials-workspace" : ""}`}
        >
          <header className="page-heading">
            <div className="heading-start">
              <Button
                variant="ghost"
                size="icon"
                className="mobile-only"
                aria-label="打开导航"
                onClick={() => setNav(true)}
              >
                <Menu />
              </Button>
              <div className="heading-copy">
                <h1>
                  {credentialsPage
                    ? "Agent 凭证"
                    : settingsPage
                      ? "团队设置"
                      : "团队动态"}
                  {!credentialsPage && !settingsPage && (
                    <span className="heading-dot" />
                  )}
                </h1>
                {!credentialsPage && !settingsPage && (
                  <span className="heading-caption">
                    每一次推进，都在这里汇合。
                  </span>
                )}
              </div>
            </div>
            {!credentialsPage && !settingsPage && (
              <div className="top-actions">
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="搜索动态"
                    placeholder="搜索动态、项目或成员…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button aria-label="清空搜索" onClick={() => setQuery("")}>
                      <X size={14} />
                    </button>
                  )}
                  <kbd>搜索</kbd>
                </label>
                {meta?.mode !== "local-demo" && meta ? (
                  <NotificationCenter
                    key={meta.team.id}
                    team={meta.team.id}
                    onSelect={(id) => {
                      const r = reports.find((r) => r.id === id);
                      if (r) markRead(r);
                      else {
                        setDetail(id);
                        void load();
                      }
                    }}
                  />
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="查看待关注事项"
                    className="bell"
                    onClick={() => {
                      setOnlyAttention((v) => !v);
                      setAttention(true);
                    }}
                  >
                    <Bell />
                    {needs.length > 0 && <i />}
                  </Button>
                )}
                <Button onClick={() => setReportTab("manual")}>
                  <Plus />
                  <span>上报</span>
                </Button>
              </div>
            )}
          </header>
          {settingsPage ? (
            <div className="team-settings-content">
              {meta ? (
                <TeamSettings
                  key={meta.team.id}
                  meta={meta}
                  onChange={() => void load()}
                />
              ) : (
                <Loader2 className="animate-spin" />
              )}
            </div>
          ) : credentialsPage ? (
            <div className="credentials-content">
              {auth.mode === "local-demo" ? (
                <p className="muted">演示模式无需凭证。</p>
              ) : (
                <TokenManager key={auth.me?.current_team} />
              )}
            </div>
          ) : (
            <>
              <div className="feed-column">
                <div className="viewbar">
                  <div className="view-tabs">
                    <button
                      className={view === "all" ? "active" : ""}
                      onClick={() => setView("all")}
                    >
                      全部动态
                    </button>
                    <button
                      className={view === "daily" ? "active" : ""}
                      onClick={() => setView("daily")}
                    >
                      日报汇总
                    </button>
                  </div>
                </div>
                <div className="desktop-filters">
                  {filtersContent}
                  <button
                    type="button"
                    className="filter-reset"
                    onClick={resetFilters}
                    disabled={!activeFilters && !onlyAttention && !query}
                  >
                    重置
                  </button>
                  {auth.mode !== "local-demo" && (
                    <button
                      type="button"
                      className={`catalog-edit-toggle${catalogOpen ? " active" : ""}`}
                      aria-label="编辑项目与领域"
                      title="编辑项目与领域"
                      aria-expanded={catalogOpen}
                      onClick={() => setCatalogOpen((v) => !v)}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {meta?.catalog?.some((c) => c.state === "pending") && (
                    <button
                      className="catalog-pending-link"
                      onClick={() => setCatalogOpen(true)}
                    >
                      待整理{" "}
                      {meta.catalog.filter((c) => c.state === "pending").length}
                    </button>
                  )}
                </div>
                <div className="mobile-filter-bar">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMobileFilters(true)}
                  >
                    <Filter />
                    筛选{activeFilters ? ` · ${activeFilters}` : ""}
                  </Button>
                  {auth.mode !== "local-demo" && (
                    <button
                      type="button"
                      className="catalog-edit-toggle"
                      aria-label="编辑项目与领域"
                      title="编辑项目与领域"
                      aria-expanded={catalogOpen}
                      onClick={() => setCatalogOpen((v) => !v)}
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  <span>{filtered.length} 条动态</span>
                  <button
                    className="text-action"
                    onClick={() => setView(view === "daily" ? "all" : "daily")}
                  >
                    <ArrowDownWideNarrow size={14} />
                    {view === "daily" ? "按日报汇总" : "按时间排序"}
                  </button>
                </div>
                <div className="domain-chips">
                  {[
                    "",
                    ...(meta?.domains || [
                      "产品",
                      "研发",
                      "设计",
                      "运营",
                      "内容",
                      "视频制作",
                    ]),
                  ].map((d) => (
                    <button
                      key={d}
                      className={filters.domain === d ? "selected" : ""}
                      onClick={() => updateFilter("domain", d)}
                    >
                      {d || "全部领域"}
                    </button>
                  ))}
                </div>
                {catalogOpen && meta && auth.mode !== "local-demo" && (
                  <div className="timeline-catalog-editor">
                    <CatalogManager
                      key={meta.team.id}
                      meta={meta}
                      onChange={() => void load()}
                      onClose={() => setCatalogOpen(false)}
                    />
                  </div>
                )}
                {(activeFilters > 0 || onlyAttention || query) && (
                  <div className="filter-summary">
                    <span>
                      当前显示 {filtered.length} 条
                      {onlyAttention ? "待关注" : ""}
                      动态
                    </span>
                    <button onClick={resetFilters}>
                      清除筛选 <X size={12} />
                    </button>
                  </div>
                )}
                <button
                  className="attention-mobile"
                  onClick={() => setAttention((v) => !v)}
                >
                  <span>
                    <span className="attention-dot" />
                    需要关注 <strong>{needs.length}</strong>
                  </span>
                  <ChevronDown
                    size={16}
                    className={attention ? "rotated" : ""}
                  />
                </button>
                {attention && (
                  <div className="attention-mobile-list">
                    {needs.map((r) => (
                      <button key={r.id} onClick={() => markRead(r)}>
                        <Status value={r.status} />
                        <span>{r.title}</span>
                        <ArrowRight size={14} />
                      </button>
                    ))}
                  </div>
                )}
                {error && (
                  <div className="error-box" role="alert">
                    <strong>暂时无法同步动态</strong>
                    <p>{error}。请确认 Go API 已启动。</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void load(true)}
                    >
                      重新连接
                    </Button>
                  </div>
                )}
                {loading ? (
                  <div className="loading">
                    <Loader2 className="animate-spin" />
                    正在汇集团队进展…
                  </div>
                ) : !error && groups.length === 0 ? (
                  <div className="empty">
                    <Search size={30} />
                    <h3>还没有匹配的动态</h3>
                    <p>调整筛选条件，或者发布第一条进展。</p>
                    <Button variant="outline" onClick={resetFilters}>
                      清除全部筛选
                    </Button>
                  </div>
                ) : (
                  groups.map(([date, rows]) => (
                    <section className="day-group" key={date}>
                      <div className="day-heading">
                        <h2>{dayLabel(date)}</h2>
                        <span>{rows.length} 条更新</span>
                      </div>
                      {view === "daily" && (
                        <div className="daily-summary">
                          <span>
                            {new Set(rows.map((r) => r.author_id)).size} 位成员
                          </span>
                          <span>
                            {
                              rows.filter((r) => r.status === "delivered")
                                .length
                            }{" "}
                            项交付
                          </span>
                          <span>
                            {rows.filter((r) => r.status === "blocked").length}{" "}
                            项阻塞
                          </span>
                          <span>
                            {rows.reduce((n, r) => n + r.links.length, 0)}{" "}
                            个交付链接
                          </span>
                          <span>
                            {
                              collaborations.filter(
                                (c) =>
                                  rows.some((r) => r.id === c.report_id) &&
                                  !["done", "cancelled"].includes(c.status),
                              ).length
                            }{" "}
                            项待办协作
                          </span>
                        </div>
                      )}
                      {view === "daily" ? (
                        <div className="daily-list">
                          {[
                            ...(meta?.members || []),
                            ...Array.from(new Set(rows.map((r) => r.author_id)))
                              .filter(
                                (id) => !meta?.members.some((m) => m.id === id),
                              )
                              .map((id) => ({
                                id,
                                name: "已离开成员",
                                role: "",
                                color: "mint",
                              })),
                          ].map((m) => {
                            const items = rows.filter(
                              (r) => r.author_id === m.id,
                            );
                            return (
                              <div className="daily-member" key={m.id}>
                                <div className="daily-author">
                                  <Avatar member={m} small />
                                  <strong>{m.name}</strong>
                                  <span>
                                    {items.length
                                      ? `${items.length} 条上报`
                                      : "暂无上报"}
                                  </span>
                                </div>
                                {items.map((r) => (
                                  <button
                                    key={r.id}
                                    onClick={() => markRead(r)}
                                  >
                                    <Status value={r.status} />
                                    <strong>{r.title}</strong>
                                    <span className="daily-project">
                                      {project(r.project_id)?.name || "未归属"}
                                    </span>
                                    <MessageCircle size={13} />
                                    <span>{r.comments.length}</span>
                                    <span>{r.links.length} 个链接</span>
                                  </button>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        rows.map((r) => (
                          <article className="report-row" key={r.id}>
                            <button
                              className="report-author"
                              onClick={() =>
                                updateFilter("member", r.author_id)
                              }
                              aria-label={`筛选成员 ${member(r.author_id)?.name}`}
                            >
                              <Avatar member={member(r.author_id)} />
                              <span>
                                <strong>
                                  {member(r.author_id)?.name || "成员"}
                                </strong>
                                <small>
                                  {project(r.project_id)?.name || "未归属"}
                                  <span> / </span>
                                  {reportDomains(r).join(" · ") || "未分类"}
                                </small>
                              </span>
                            </button>
                            <div className="report-content">
                              <div className="report-meta">
                                <Agent name={r.agent} />
                                <time>{clock(r.created_at)}</time>
                                {(!seen[r.id] ||
                                  Date.parse(seen[r.id]) <
                                    Date.parse(r.updated_at)) && (
                                  <i className="unread-dot" title="未读" />
                                )}
                              </div>
                              <button
                                className="report-title"
                                onClick={() => markRead(r)}
                              >
                                {r.title}
                              </button>
                              <p>{r.body.split("\n")[0]}</p>
                              <div className="report-links">
                                {r.links.map((l, i) => (
                                  <a
                                    href={l.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    key={i}
                                  >
                                    <ExternalLink size={13} />
                                    {l.title || "交付链接"}
                                  </a>
                                ))}
                              </div>
                            </div>
                            <div className="report-state">
                              <Status value={r.status} />
                              <button onClick={() => markRead(r)}>
                                <MessageCircle size={14} />
                                {r.comments.length} 条评论
                                {collaborations.some(
                                  (c) =>
                                    c.report_id === r.id &&
                                    !["done", "cancelled"].includes(c.status),
                                ) && <small> · 有待办协作</small>}
                              </button>
                            </div>
                          </article>
                        ))
                      )}
                    </section>
                  ))
                )}
              </div>
              <aside className="right-rail">
                <section className="rail-card">
                  <div className="rail-title">
                    <h2>
                      需要关注 <span>{needs.length}</span>
                    </h2>
                    <button
                      aria-label="筛选全部待关注事项"
                      onClick={() => setOnlyAttention((v) => !v)}
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                  {needs.length ? (
                    needs.slice(0, 4).map((r) => (
                      <button
                        className="attention-item"
                        key={r.id}
                        onClick={() => markRead(r)}
                      >
                        <i
                          className={r.status === "blocked" ? "red" : "amber"}
                        />
                        <span>
                          <strong>{r.title}</strong>
                          <small>
                            {member(r.author_id)?.name} · {clock(r.created_at)}
                          </small>
                        </span>
                        <ChevronDown size={14} />
                      </button>
                    ))
                  ) : (
                    <p className="muted text-sm">当前没有阻塞或待反馈事项。</p>
                  )}
                </section>
                <section className="rail-card">
                  <div className="rail-title">
                    <h2>进行中的项目</h2>
                    <span className="muted text-xs">
                      {meta?.projects.filter((p) => p.status !== "archived")
                        .length || 0}
                    </span>
                  </div>
                  {meta?.projects
                    .filter((p) => p.status !== "archived")
                    .map((p, i) => (
                      <button
                        className={`project-row ${filters.project === p.id ? "chosen" : ""}`}
                        key={p.id}
                        onClick={() =>
                          updateFilter(
                            "project",
                            filters.project === p.id ? "" : p.id,
                          )
                        }
                      >
                        <span className={`project-icon project-${i}`}>
                          <Link2 size={17} />
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>{p.domains.join(" · ")}</small>
                        </span>
                        <i
                          className={
                            ["进行中", "active"].includes(p.status)
                              ? "online-dot"
                              : "planned-dot"
                          }
                        />
                      </button>
                    ))}
                </section>
                <section className="rail-card team-card">
                  <div className="rail-title">
                    <h2>
                      团队 <span>· {meta?.members.length || 5} 人</span>
                    </h2>
                    <Users size={16} />
                  </div>
                  <div className="team-members">
                    {meta?.members.map((m) => (
                      <button
                        key={m.id}
                        onClick={() =>
                          updateFilter(
                            "member",
                            filters.member === m.id ? "" : m.id,
                          )
                        }
                      >
                        <Avatar member={m} />
                        <strong>{m.name}</strong>
                        <small>
                          {m.role === "admin"
                            ? "管理员"
                            : m.role === "member"
                              ? "成员"
                              : m.role}
                        </small>
                      </button>
                    ))}
                  </div>
                </section>
                <AgentConnectCard
                  onCredentials={() => router.push("/credentials")}
                />
                <p className="demo-note">
                  {meta?.mode === "local-demo" ? (
                    <>
                      本地演示 · 示例人物与交付链接
                      <br />
                      上报及评论会保存在本机
                    </>
                  ) : (
                    <>
                      团队数据由 PostgreSQL 持久化
                      <br />每 30 秒同步进展
                    </>
                  )}
                </p>
              </aside>
            </>
          )}
        </div>
      </main>
      <Dialog open={nav} onOpenChange={setNav}>
        <DialogContent className="nav-dialog">
          <DialogTitle className="sr-only">工作空间导航</DialogTitle>
          <DialogDescription className="sr-only">
            导航与团队工具
          </DialogDescription>
          {navigation}
        </DialogContent>
      </Dialog>
      <Dialog open={mobileFilters} onOpenChange={setMobileFilters}>
        <DialogContent className="filter-dialog">
          <DialogTitle className="modal-title">筛选动态</DialogTitle>
          <DialogDescription className="modal-description">
            组合查看项目、领域、成员和 Agent 的进展。
          </DialogDescription>
          <div className="mobile-filter-fields">
            {filtersContent}
            {domainFilter}
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={resetFilters}>
              重置
            </Button>
            <Button className="flex-1" onClick={() => setMobileFilters(false)}>
              查看 {filtered.length} 条动态
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="detail-dialog">
          {selected && meta && (
            <Detail
              key={selected.id}
              report={selected}
              collaborations={collaborations.filter(
                (c) => c.report_id === selected.id,
              )}
              meta={meta}
              onChange={() => void load()}
              onSaved={setNotice}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={reportTab !== null}
        onOpenChange={(open) => {
          if (!open) setReportTab(null);
        }}
      >
        <DialogContent className="report-hub-dialog info-dialog">
          {meta && (
            <ReportHub
              initialTab={reportTab || "manual"}
              meta={meta}
              onClose={() => setReportTab(null)}
              onReported={() => {
                setReportTab(null);
                setNotice("进展已同步到 Timeline");
                void load();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
    </div>
  );
}
function Detail({
  report: r,
  collaborations,
  meta,
  onChange,
  onSaved,
}: {
  report: Report;
  collaborations: Collaboration[];
  meta: Meta;
  onChange: () => void;
  onSaved: (s: string) => void;
}) {
  const [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const canEdit =
    r.author_id === meta.current_user ||
    (meta.mode !== "local-demo" && meta.role === "admin");
  const author = meta.members.find((m) => m.id === r.author_id);
  async function comment(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      await request(`/reports/${r.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body, mentions }),
      });
      setBody("");
      setMentions([]);
      onChange();
      onSaved("评论已发布");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resolve() {
    setBusy(true);
    setError("");
    try {
      await request(`/reports/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "resolved" }),
      });
      onChange();
      onSaved("已标记解决");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <div className="detail-body report-edit-body">
        <DialogTitle className="modal-title">编辑简报</DialogTitle>
        <DialogDescription className="sr-only">
          修改标题、内容、分类和交付链接，保留原始来源与讨论。
        </DialogDescription>
        <ReportCompose
          meta={meta}
          report={r}
          onStale={onChange}
          onCancel={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            onChange();
            onSaved("简报已更新");
          }}
        />
      </div>
    );
  return (
    <>
      <div className="detail-body">
        <div className="detail-source">
          <Avatar member={author} small />
          <strong>{author?.name}</strong>
          <Agent name={r.agent} />
          <time>{clock(r.created_at)}</time>
        </div>
        <DialogTitle className="detail-title">{r.title}</DialogTitle>
        <DialogDescription className="detail-description">
          {meta.projects.find((p) => p.id === r.project_id)?.name || "未归属"} /{" "}
          {reportDomains(r).join(" · ") || "未分类"} · {dateKey(r.created_at)}
        </DialogDescription>
        <div className="detail-status">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <Pencil />
              编辑
            </Button>
          )}
          <Status value={r.status} />
          {(r.author_id === meta.current_user ||
            (meta.mode !== "local-demo" && meta.role === "admin")) &&
            ["blocked", "review"].includes(r.status) && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void resolve()}
              >
                <Check />
                标记解决
              </Button>
            )}
        </div>
        {meta.mode !== "local-demo" && (
          <ClassificationEditor
            key={r.id + String(r.classification_locked)}
            report={r}
            meta={meta}
            onChange={onChange}
          />
        )}
        <Markdown>{r.body}</Markdown>
        <div className="detail-links">
          {r.links.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} />
              <span>
                {l.title || "交付链接"}
                <small>{new URL(l.url).hostname}</small>
              </span>
              <ArrowUpRight size={16} />
            </a>
          ))}
        </div>
        {r.model && <p className="source-note">来源 Model：{r.model}</p>}
        {meta.mode !== "local-demo" && (
          <>
            <CollaborationPanel
              report={r}
              meta={meta}
              items={collaborations}
              onChange={onChange}
            />
            <ReportHistory id={r.id} meta={meta} updatedAt={r.updated_at} />
          </>
        )}
        <div className="discussion-heading">
          <h3>讨论</h3>
          <span>{r.comments.length}</span>
        </div>
        {r.comments.length ? (
          r.comments.map((c) => {
            const m = meta.members.find((m) => m.id === c.author_id);
            return (
              <div className="comment" key={c.id}>
                <Avatar member={m} small />
                <div>
                  <div className="comment-source">
                    <strong>{m?.name}</strong>
                    <time>{clock(c.created_at)}</time>
                  </div>
                  <Markdown>{c.body}</Markdown>
                </div>
              </div>
            );
          })
        ) : (
          <p className="discussion-empty">
            还没有评论。可以补充反馈，或讨论下一步。
          </p>
        )}
      </div>
      <form className="comment-form" onSubmit={comment}>
        <label htmlFor="comment-body">
          以
          {meta.members.find((m) => m.id === meta.current_user)?.name ||
            "当前成员"}
          的身份回复
        </label>
        <textarea
          id="comment-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="分享反馈或协作建议，支持 Markdown…"
          rows={3}
          maxLength={4000}
        />
        {meta.mode !== "local-demo" && (
          <div className="mention-picker" aria-label="提醒成员">
            {meta.members
              .filter((m) => m.id !== meta.current_user)
              .map((m) => (
                <label key={m.id}>
                  <input
                    type="checkbox"
                    checked={mentions.includes(m.id)}
                    onChange={(e) =>
                      setMentions((old) =>
                        e.target.checked
                          ? [...old, m.id]
                          : old.filter((id) => id !== m.id),
                      )
                    }
                  />
                  @{m.name}
                </label>
              ))}
          </div>
        )}
        <div className="comment-form-footer">
          <span className="error-text" role="alert">
            {error}
          </span>
          <Button type="submit" disabled={busy || !body.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <MessageCircle />}
            发布评论
          </Button>
        </div>
      </form>
    </>
  );
}
