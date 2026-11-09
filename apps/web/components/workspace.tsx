"use client";

import { LoadingStatus, PageLoading } from "./ui/loading-status";
import { loadTodoPages } from "@/lib/todo-loader";
import { useI18n } from "@/components/i18n-provider";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CalendarDays,
  BookOpen,
  Copy,
  Trash2,
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
import { Button } from "@/components/ui/button";
import { DeleteAction, TrashList } from "@/components/content-actions";
import { defaultColumnName, type Todo, type TodoBoardData } from "@/lib/todo";
import {
  AssistantWorkspace,
  AssistantPanel,
  AssistantTrigger,
} from "./assistant-workspace";
import { GlobalFilters, useSharedFilters } from "./shared-filters";
import { Avatar, Agent, Status, Markdown, ReportDetail } from "./report-detail";
import { CalendarWorkspace } from "@/components/calendar-workspace";
import { ContextWorkspace } from "./context-workspace";
import { TodoBoard } from "@/components/todo-board";
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
import { useAuth } from "@/components/auth-gate";
import { CoFlowLogo } from "@/components/coflow-logo";
import { publicDemo, repositoryURL } from "@/lib/runtime";
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
  invalidateReadCache,
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
type LocalFilters = Pick<Filters, "agent" | "days">;
const initialFilters: LocalFilters = {
  agent: "",
  days: "7",
};
function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  options: {
    id: string;
    name: string;
  }[];
}) {
  const { t: tr } = useI18n();
  return (
    <label className={`filter-select${value ? " is-active" : ""}`}>
      <span>{tr(label)}</span>
      <select
        aria-label={tr(label)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{tr("全部")}</option>
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
export function Workspace({ children }: { children: React.ReactNode }) {
  const { t: tr, locale, timeZone, date: formatDate } = useI18n();
  const router = useRouter();
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const assistantPage = pathname === "/assistant";
  const contextPage = pathname === "/context";
  const todoPage = pathname === "/todo";
  const calendarPage = pathname === "/calendar";
  const credentialsPage = pathname === "/credentials";
  const settingsPage = pathname === "/settings";
  const newTeamPage = pathname === "/teams/new";
  const timelinePage = useRef(false);
  timelinePage.current =
    !assistantPage &&
    !contextPage &&
    !todoPage &&
    !calendarPage &&
    !credentialsPage &&
    !settingsPage &&
    !newTeamPage;
  const auth = useAuth();
  const shared = useSharedFilters();
  const activeTeam = useRef(auth.me?.current_team);
  activeTeam.current = auth.me?.current_team;
  const loadVersion = useRef(0);
  const timelineReady = useRef(false);
  const [todoColumns, setTodoColumns] = useState<TodoBoardData["columns"]>([]);
  const [todoIndex, setTodoIndex] = useState<Todo[]>([]);
  const [todoCompletions, setTodoCompletions] = useState<
    {
      todo_id: string;
      completed_at: string;
      assignee_id: string;
      project_id: string;
      domains: string[];
      creator_id: string;
      agent: string;
    }[]
  >([]);
  const [collaborations, setCollaborations] = useState<Collaboration[]>([]);
  const [scope, setScope] = useState<"all" | "related" | "todo">("all");
  const [meta, setMeta] = useState<Meta | null>(null),
    [reports, setReports] = useState<Report[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [localFilters, setLocalFilters] =
      useState<LocalFilters>(initialFilters),
    [query, setQuery] = useState(""),
    [view, setView] = useState("all"),
    [unread, setUnread] = useState(false);
  const filters = useMemo(
    () => ({ ...localFilters, ...shared.filters }),
    [localFilters, shared.filters],
  );
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
  const [trashOpen, setTrashOpen] = useState(false);
  const linkedTeam = useRef<string | null>(null);
  useEffect(() => {
    const user = auth.me?.user;
    if (!user) return;
    setMeta((previous) => {
      if (!previous || previous.team.id !== auth.me?.current_team)
        return previous;
      return {
        ...previous,
        members: previous.members.map((member) =>
          member.id === user.id
            ? { ...member, name: user.name, avatar_data: user.avatar_data }
            : member,
        ),
      };
    });
  }, [
    auth.me?.user.name,
    auth.me?.user.avatar_data,
    auth.me?.current_team,
    auth.me?.user.id,
  ]);
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
      if (timelinePage.current && !timelineReady.current) setLoading(true);
      if (initial) {
        invalidateReadCache();
        setLoading(true);
      }
      try {
        const read = <T,>(path: string) =>
          request<T>(path, initial ? { cache: "no-store" } : undefined);
        // Other pages need team context, not Timeline's entire history and indexes.
        if (!timelinePage.current) {
          const m = await read<Meta>("/meta");
          if (current() && (!team || m.team.id === team)) {
            setMeta(m);
            setError("");
          }
          return;
        }
        const [
          m,
          r,
          boardData,
          reads,
          cs,
          activeTasks,
          archivedTasks,
          completed,
        ] = await Promise.all([
          read<Meta>("/meta"),
          read<{ items: Report[] }>("/reports"),
          read<TodoBoardData>("/todo-board"),
          auth.mode === "local-demo"
            ? Promise.resolve({ items: {} })
            : read<{ items: Record<string, string> }>("/reads"),
          auth.mode === "local-demo"
            ? Promise.resolve({ items: [] })
            : read<{ items: Collaboration[] }>("/collaborations"),
          loadTodoPages(read, { archived: "false" }),
          loadTodoPages(read, { archived: "true" }),
          read<{ items: typeof todoCompletions }>("/todo-completions"),
        ]);
        if (!current() || (team && m.team.id !== team)) return;
        const allTasks = [...activeTasks, ...archivedTasks];
        if (m.mode !== "local-demo") setSeen(reads.items);
        setCollaborations(cs.items);
        timelineReady.current = true;
        setTodoIndex(allTasks);
        setTodoColumns(boardData.columns);
        setTodoCompletions(completed.items);
        setMeta(m);
        setReports(r.items);
        setError("");
      } catch (e) {
        if (current()) setError((e as Error).message);
      } finally {
        if (current()) setLoading(false);
      }
    },
    [auth.me?.current_team, auth.me?.user.id, auth.mode],
  );
  useEffect(() => {
    const changed = () => void load();
    window.addEventListener("coflow:assistant-change", changed);
    return () => window.removeEventListener("coflow:assistant-change", changed);
  }, [load]);
  useEffect(() => {
    setLocalFilters(initialFilters);
    setScope("all");
    setUnread(false);
    setDetail(null);
    setCatalogOpen(false);
    setTrashOpen(false);
    setSeen({});
    setReports([]);
    setTodoIndex([]);
    setTodoCompletions([]);
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
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      setDetail(null);
      linkedTeam.current = null;
      void load();
    }
  }, [pathname, load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (
      loading ||
      !timelineReady.current ||
      !meta ||
      contextPage ||
      todoPage ||
      calendarPage ||
      credentialsPage ||
      settingsPage ||
      newTeamPage
    )
      return;
    const id = new URL(window.location.href).searchParams.get("report");
    const key = `${meta.team.id}:${id}`;
    if (!id || linkedTeam.current === key) return;
    linkedTeam.current = key;
    const found = reports.find((r) => r.id === id);
    if (found) setDetail(id);
    else setNotice("简报不存在、已删除或不属于当前团队");
  }, [
    loading,
    meta,
    reports,
    contextPage,
    todoPage,
    calendarPage,
    credentialsPage,
    settingsPage,
    newTeamPage,
  ]);
  const member = (id: string) => meta?.members.find((m) => m.id === id);
  const project = (id: string) => meta?.projects.find((p) => p.id === id);
  const markRead = (r: Report) => {
    setDetail(r.id);
    if (meta?.mode !== "local-demo")
      void request(`/reports/${r.id}/read`, {
        method: "POST",
        body: JSON.stringify({
          seen_at: r.updated_at,
        }),
      }).catch((e) => setNotice(`已读同步失败：${e.message}`));
    setSeen((prev) => {
      const next = {
        ...prev,
        [r.id]: r.updated_at,
      };
      if (meta?.mode === "local-demo")
        localStorage.setItem("coflow-seen", JSON.stringify(next));
      return next;
    });
  };
  const updateFilter = (key: keyof Filters, value: string) => {
    if (key === "project" || key === "domain" || key === "member")
      shared.update({ [key]: value });
    else setLocalFilters((prev) => ({ ...prev, [key]: value }));
  };
  function resetFilters() {
    setLocalFilters(initialFilters);
    setScope("all");
    setUnread(false);
    setOnlyAttention(false);
    setQuery("");
  }
  const needs = reports.filter(
    (r) =>
      (r.status === "blocked" || r.status === "review") &&
      (!filters.project || r.project_id === filters.project) &&
      (!filters.domain || reportDomains(r).includes(filters.domain)) &&
      (!filters.member || r.author_id === filters.member),
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
              !c.todo_id &&
              !c.todo_id &&
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
  const filteredCompletions = useMemo(
    () =>
      todoCompletions.filter(
        (e) =>
          (!filters.project || e.project_id === filters.project) &&
          (!filters.domain || e.domains.includes(filters.domain)) &&
          (!filters.member || e.assignee_id === filters.member) &&
          (!filters.agent || e.agent === filters.agent) &&
          (!filters.days ||
            Date.parse(e.completed_at) >=
              Date.now() - Number(filters.days) * 86400000) &&
          (!query ||
            todoIndex
              .find((t) => t.id === e.todo_id)
              ?.title.toLowerCase()
              .includes(query.toLowerCase())) &&
          (scope !== "todo" || e.assignee_id === meta?.current_user) &&
          (scope !== "related" ||
            e.creator_id === meta?.current_user ||
            e.assignee_id === meta?.current_user),
      ),
    [todoCompletions, filters, query, todoIndex, scope, meta],
  );
  const groups = useMemo(() => {
    const map = new Map<string, Report[]>();
    for (const r of filtered) {
      const key = dateKey(r.created_at, timeZone);
      map.set(key, [...(map.get(key) || []), r]);
    }
    if (view === "daily" && !unread && !onlyAttention)
      for (const e of filteredCompletions) {
        const key = dateKey(e.completed_at, timeZone);
        if (!map.has(key)) map.set(key, []);
      }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [filtered, timeZone, view, filteredCompletions, unread, onlyAttention]);
  const selected = reports.find((r) => r.id === detail);
  const today = dateKey(new Date().toISOString(), timeZone);
  const dayLabel = (key: string) => {
    const yesterday = dateKey(
      new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString(),
      "UTC",
    );
    const prefix =
      key === today ? tr("今天 · ") : key === yesterday ? tr("昨天 · ") : "";
    return (
      prefix +
      formatDate(`${key}T12:00:00Z`, {
        timeZone: "UTC",
        month: "long",
        day: "numeric",
      })
    );
  };
  const activeFilters =
    Object.entries(localFilters).filter(
      ([k, v]) => v !== initialFilters[k as keyof LocalFilters],
    ).length +
    Number(scope !== "all") +
    Number(unread);
  const pendingCount = collaborations.filter(
    (c) =>
      c.assignee_id === meta?.current_user &&
      !c.todo_id &&
      !c.todo_id &&
      !["done", "cancelled"].includes(c.status),
  ).length;
  const filtersContent = (
    <>
      <SelectFilter
        label="Agent"
        value={filters.agent}
        onChange={(v) => updateFilter("agent", v)}
        options={[...new Set(reports.map((r) => r.agent).filter(Boolean))].map(
          (a) => ({
            id: a,
            name: ["手动上报", "其他 Agent"].includes(a) ? tr(a) : a,
          }),
        )}
      />
      <label className={`filter-select${filters.days ? " is-active" : ""}`}>
        <span>{tr("日期")}</span>
        <select
          aria-label={tr("日期")}
          value={filters.days}
          onChange={(e) => updateFilter("days", e.target.value)}
        >
          <option value="1">{tr("最近 24 小时")}</option>
          <option value="7">{tr("最近 7 天")}</option>
          <option value="30">{tr("最近 30 天")}</option>
          <option value="">{tr("全部时间")}</option>
        </select>
        <ChevronDown size={14} />
      </label>
      <div className="filter-personal">
        <div
          className="scope-shortcuts"
          role="group"
          aria-label={tr("动态范围")}
        >
          <button
            type="button"
            aria-pressed={scope === "all"}
            title={tr("团队全部动态")}
            onClick={() => setScope("all")}
          >
            {tr("全部")}
          </button>
          <button
            type="button"
            aria-pressed={scope === "related"}
            title={tr("我发布、评论、被提及或参与协作的动态")}
            onClick={() => setScope("related")}
          >
            {tr("与我相关")}
          </button>
          {meta?.mode !== "local-demo" && (
            <button
              type="button"
              aria-pressed={scope === "todo"}
              title={tr("分配给我且尚未完成的协作")}
              onClick={() => setScope("todo")}
            >
              {tr("待我处理")}
              <span>{pendingCount}</span>
            </button>
          )}
        </div>
        <label className={`filter-unread${unread ? " is-active" : ""}`}>
          <input
            type="checkbox"
            checked={unread}
            onChange={(e) => setUnread(e.target.checked)}
          />
          {tr("未读")}
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
            aria-label={tr("点击 Logo 展开侧边栏")}
            title={tr("展开侧边栏")}
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
            aria-label={tr("收起侧边栏")}
            title={tr("收起侧边栏")}
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
          tr("工作空间")
        }
        onNavigate={() => setNav(false)}
      />
      <nav>
        <Link
          href={shared.href("/")}
          className={
            !assistantPage &&
            !contextPage &&
            !todoPage &&
            !calendarPage &&
            !credentialsPage &&
            !settingsPage
              ? "nav-active"
              : ""
          }
          aria-current={
            !assistantPage &&
            !contextPage &&
            !todoPage &&
            !calendarPage &&
            !credentialsPage &&
            !settingsPage
              ? "page"
              : undefined
          }
          aria-label="Timeline"
          title="Timeline"
          onClick={() => setNav(false)}
        >
          <Clock3 size={18} />
          <span className="nav-label">Timeline</span>
        </Link>
        <Link
          href={shared.href("/todo")}
          className={todoPage ? "nav-active" : ""}
          aria-current={todoPage ? "page" : undefined}
          title="Todo"
          aria-label="Todo"
          onClick={() => setNav(false)}
        >
          <Check size={18} />
          <span className="nav-label">Todo</span>
        </Link>
        <Link
          href={shared.href("/calendar")}
          className={calendarPage ? "nav-active" : ""}
          aria-current={calendarPage ? "page" : undefined}
          title="Calendar"
          aria-label="Calendar"
          onClick={() => setNav(false)}
        >
          <CalendarDays size={18} />
          <span className="nav-label">Calendar</span>
        </Link>
        <Link
          href={shared.href("/context")}
          className={contextPage ? "nav-active" : ""}
          aria-current={contextPage ? "page" : undefined}
          title="Context"
          aria-label="Context"
          onClick={() => setNav(false)}
        >
          <BookOpen size={18} />
          <span className="nav-label">Context</span>
        </Link>
        <Link
          href={shared.href("/assistant")}
          className={assistantPage ? "nav-active" : ""}
          aria-current={assistantPage ? "page" : undefined}
          title={tr("AI 助手")}
          aria-label={tr("AI 助手")}
          onClick={() => setNav(false)}
        >
          <MessageCircle size={18} />
          <span className="nav-label">{tr("AI 助手")}</span>
        </Link>
      </nav>
      <div className="nav-bottom">
        <Link
          href="/docs"
          aria-label={tr("协作指南")}
          title={tr("协作指南")}
          onClick={() => setNav(false)}
        >
          <BookOpen size={18} />
          <span className="nav-label">{tr("协作指南")}</span>
        </Link>
        <Link
          href="/credentials"
          aria-label={tr("Agent 凭证")}
          title={tr("Agent 凭证")}
          className={credentialsPage ? "nav-active" : ""}
          aria-current={credentialsPage ? "page" : undefined}
          onClick={() => setNav(false)}
        >
          <KeyRound size={18} />
          <span className="nav-label">{tr("Agent 凭证")}</span>
        </Link>
        <Link
          href="/settings"
          aria-label={tr("团队设置")}
          title={tr("团队设置")}
          className={settingsPage ? "nav-active" : ""}
          aria-current={settingsPage ? "page" : undefined}
          onClick={() => setNav(false)}
        >
          <Settings2 size={18} />
          <span className="nav-label">{tr("团队设置")}</span>
        </Link>
        <AccountMenu
          avatar={<Avatar member={member(meta?.current_user || "")} small />}
          name={
            member(meta?.current_user || "")?.name ||
            auth.me?.user.name ||
            tr("成员")
          }
          role={
            auth.mode === "local-demo"
              ? publicDemo
                ? tr("演示体验者")
                : tr("本地演示身份")
              : meta?.role === "admin"
                ? tr("团队管理员")
                : tr("团队成员")
          }
        />
      </div>
    </>
  );
  if (newTeamPage && !publicDemo)
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
      <AssistantPanel />
      {!assistantPage && <AssistantTrigger />}
      <aside className="sidebar">{navigation}</aside>
      <main className={`main-shell${todoPage ? " todo-main" : ""}`}>
        {publicDemo && (
          <div className="public-demo-banner" role="note">
            <span>
              <strong>{tr("公开演示")}</strong>
              {tr("虚拟团队 · 操作仅本页有效，刷新后重置")}
            </span>
            <a href={repositoryURL} target="_blank" rel="noopener noreferrer">
              GitHub ↗
            </a>
          </div>
        )}
        <div
          className={`workspace-content${contextPage ? " knowledge-content" : ""}${credentialsPage || settingsPage ? " credentials-workspace" : ""}`}
        >
          {!credentialsPage &&
            !settingsPage &&
            !newTeamPage &&
            (meta ? (
              <GlobalFilters meta={meta} />
            ) : (
              <div
                className="workspace-global-filters global-filters-placeholder"
                aria-hidden="true"
              />
            ))}
          <header
            className={`page-heading${contextPage ? " context-page-heading" : todoPage ? " todo-page-heading module-page-heading" : calendarPage ? " calendar-page-heading module-page-heading" : ""}`}
          >
            <div className="heading-start">
              <Button
                variant="ghost"
                size="icon"
                className="mobile-only"
                aria-label={tr("打开导航")}
                onClick={() => setNav(true)}
              >
                <Menu />
              </Button>
              <div className="heading-copy">
                <h1>
                  {assistantPage
                    ? tr("AI 助手")
                    : contextPage
                      ? "Context"
                      : todoPage
                        ? "Todo"
                        : calendarPage
                          ? "Calendar"
                          : credentialsPage
                            ? tr("Agent 凭证")
                            : settingsPage
                              ? tr("团队设置")
                              : tr("团队动态")}
                  {!assistantPage &&
                    !contextPage &&
                    !todoPage &&
                    !calendarPage &&
                    !credentialsPage &&
                    !settingsPage && <span className="heading-dot" />}
                </h1>
                {todoPage && (
                  <span className="heading-caption">
                    {tr("多人、多 Agent 协同交付")}
                  </span>
                )}
                {!assistantPage &&
                  !contextPage &&
                  !todoPage &&
                  !calendarPage &&
                  !credentialsPage &&
                  !settingsPage && (
                    <span className="heading-caption">
                      {tr("每一次推进，都在这里汇合。")}
                    </span>
                  )}
              </div>
            </div>
            {(todoPage || calendarPage) && (
              <div
                id={
                  todoPage ? "todo-header-actions" : "calendar-header-filters"
                }
                className="module-header-tools"
              />
            )}
            {contextPage && (
              <div
                id="context-header-actions"
                className="top-actions context-header-actions"
              />
            )}
            {!assistantPage &&
              !contextPage &&
              !todoPage &&
              !calendarPage &&
              !credentialsPage &&
              !settingsPage && (
                <div className="top-actions">
                  <LoadingStatus active={loading && timelineReady.current} />
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label={tr("搜索动态")}
                      placeholder={tr("搜索动态、项目或成员…")}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                      <button
                        aria-label={tr("清空搜索")}
                        onClick={() => setQuery("")}
                      >
                        <X size={14} />
                      </button>
                    )}
                    <kbd>{tr("搜索")}</kbd>
                  </label>
                  {meta?.mode !== "local-demo" && meta ? (
                    <NotificationCenter
                      key={`${meta.team.id}:${meta.current_user}:${meta.role}`}
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
                      aria-label={tr("查看待关注事项")}
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
                    <span>{tr("上报")}</span>
                  </Button>
                </div>
              )}
          </header>
          {assistantPage ? (
            <AssistantWorkspace />
          ) : calendarPage ? (
            meta ? (
              <Suspense fallback={<PageLoading variant="calendar" />}>
                <CalendarWorkspace
                  key={`${meta.team.id}:${meta.current_user}:${meta.role}`}
                  meta={meta}
                />
              </Suspense>
            ) : (
              <PageLoading variant="calendar" />
            )
          ) : contextPage ? (
            meta ? (
              <ContextWorkspace
                key={`${meta.team.id}:${meta.current_user}:${meta.role}`}
                meta={meta}
              />
            ) : (
              <PageLoading variant="list" />
            )
          ) : todoPage ? (
            meta ? (
              <TodoBoard
                key={`${meta.team.id}:${meta.current_user}:${meta.role}`}
                meta={meta}
              />
            ) : (
              <PageLoading variant="board" />
            )
          ) : settingsPage ? (
            <div className="team-settings-content">
              {meta ? (
                <TeamSettings
                  key={`${meta.team.id}:${meta.current_user}:${meta.role}`}
                  meta={meta}
                  onChange={() => void load()}
                />
              ) : (
                <PageLoading variant="settings" />
              )}
            </div>
          ) : credentialsPage ? (
            <div className="credentials-content">
              {auth.mode === "local-demo" ? (
                <p className="muted">
                  {publicDemo
                    ? tr(
                        "公开演示不签发凭证。请在自己的 CoFlow 实例中配置 Agent。",
                      )
                    : tr("演示模式无需凭证。")}
                </p>
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
                      {tr("全部动态")}
                    </button>
                    <button
                      className={view === "daily" ? "active" : ""}
                      onClick={() => setView("daily")}
                    >
                      {tr("日报汇总")}
                    </button>
                  </div>
                  {auth.mode !== "local-demo" && (
                    <button
                      type="button"
                      className="trash-toggle"
                      onClick={() => setTrashOpen(true)}
                    >
                      <Trash2 size={14} />
                      {tr("回收站")}
                    </button>
                  )}
                </div>
                <div className="desktop-filters">
                  {filtersContent}
                  <button
                    type="button"
                    className="filter-reset"
                    onClick={resetFilters}
                    disabled={!activeFilters && !onlyAttention && !query}
                  >
                    {tr("重置本页")}
                  </button>
                  {auth.mode !== "local-demo" && (
                    <button
                      type="button"
                      className={`catalog-edit-toggle${catalogOpen ? " active" : ""}`}
                      aria-label={tr("编辑项目与领域")}
                      title={tr("编辑项目与领域")}
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
                      {tr("待整理")}{" "}
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
                    {tr("筛选")}
                    {activeFilters ? ` · ${activeFilters}` : ""}
                  </Button>
                  {auth.mode !== "local-demo" && (
                    <button
                      type="button"
                      className="catalog-edit-toggle"
                      aria-label={tr("编辑项目与领域")}
                      title={tr("编辑项目与领域")}
                      aria-expanded={catalogOpen}
                      onClick={() => setCatalogOpen((v) => !v)}
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  <span>
                    {tr("{count} 条动态", {
                      count: filtered.length,
                    })}
                  </span>
                  <button
                    className="text-action"
                    onClick={() => setView(view === "daily" ? "all" : "daily")}
                  >
                    <ArrowDownWideNarrow size={14} />
                    {view === "daily" ? tr("按日报汇总") : tr("按时间排序")}
                  </button>
                </div>
                {catalogOpen && meta && auth.mode !== "local-demo" && (
                  <div className="timeline-catalog-editor">
                    <CatalogManager
                      key={`${meta.team.id}:${meta.current_user}:${meta.role}`}
                      meta={meta}
                      onChange={() => void load()}
                      onClose={() => setCatalogOpen(false)}
                    />
                  </div>
                )}
                {(activeFilters > 0 || onlyAttention || query) && (
                  <div className="filter-summary">
                    <span>
                      {tr(
                        onlyAttention
                          ? "当前显示 {count} 条待关注动态"
                          : "当前显示 {count} 条动态",
                        {
                          count: filtered.length,
                        },
                      )}
                    </span>
                  </div>
                )}
                <button
                  className="attention-mobile"
                  onClick={() => setAttention((v) => !v)}
                >
                  <span>
                    <span className="attention-dot" />
                    {tr("需要关注")}
                    <strong>{needs.length}</strong>
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
                    <strong>{tr("暂时无法同步动态")}</strong>
                    <p>
                      {tr(error)}
                      {tr("。请确认 Go API 已启动。")}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void load(true)}
                    >
                      {tr("重新连接")}
                    </Button>
                  </div>
                )}
                {loading && !timelineReady.current ? (
                  <PageLoading variant="timeline" />
                ) : !error && groups.length === 0 ? (
                  <div className="empty">
                    <Search size={30} />
                    <h3>{tr("还没有匹配的动态")}</h3>
                    <p>{tr("调整筛选条件，或者发布第一条进展。")}</p>
                    <Button
                      variant="outline"
                      onClick={() =>
                        activeFilters || onlyAttention || query
                          ? resetFilters()
                          : shared.update({
                              project: "",
                              domain: "",
                              member: "",
                            })
                      }
                    >
                      {tr(
                        activeFilters || onlyAttention || query
                          ? "重置本页"
                          : "重置全局筛选",
                      )}
                    </Button>
                  </div>
                ) : (
                  groups.map(([date, rows]) => (
                    <section className="day-group" key={date}>
                      <div className="day-heading">
                        <h2>{dayLabel(date)}</h2>
                        <span>
                          {tr("{count} 条更新", {
                            count: rows.length,
                          })}
                        </span>
                      </div>
                      {view === "daily" && (
                        <div className="daily-summary">
                          <span>
                            {tr("{count} 位成员", {
                              count: new Set(rows.map((r) => r.author_id)).size,
                            })}
                          </span>
                          <span>
                            {tr("{count} 项交付", {
                              count: rows.filter(
                                (r) => r.status === "delivered",
                              ).length,
                            })}
                          </span>
                          <span>
                            {tr("{count} 项阻塞", {
                              count: rows.filter((r) => r.status === "blocked")
                                .length,
                            })}
                          </span>
                          <span>
                            {tr("{count} 个交付链接", {
                              count: rows.reduce(
                                (n, r) => n + r.links.length,
                                0,
                              ),
                            })}
                          </span>
                          <span>
                            {tr("{count} 项待办协作", {
                              count: collaborations.filter(
                                (c) =>
                                  rows.some((r) => r.id === c.report_id) &&
                                  !c.todo_id &&
                                  !["done", "cancelled"].includes(c.status),
                              ).length,
                            })}
                          </span>
                        </div>
                      )}
                      {view === "daily" && (
                        <p className="muted">
                          {tr("{count} 项任务完成", {
                            count: new Set(
                              filteredCompletions
                                .filter(
                                  (e) =>
                                    dateKey(e.completed_at, timeZone) === date,
                                )
                                .map((e) => e.todo_id),
                            ).size,
                          })}
                        </p>
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
                                name: tr("已离开成员"),
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
                                      ? tr("{count} 条上报", {
                                          count: items.length,
                                        })
                                      : tr("暂无上报")}
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
                                      {project(r.project_id)?.name ||
                                        tr("未归属")}
                                    </span>
                                    <MessageCircle size={13} />
                                    <span>{r.comments.length}</span>
                                    <span>
                                      {tr("{count} 个链接", {
                                        count: r.links.length,
                                      })}
                                    </span>
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
                              aria-label={tr("筛选成员 {0}", {
                                0: member(r.author_id)?.name,
                              })}
                            >
                              <Avatar member={member(r.author_id)} />
                              <span>
                                <strong>
                                  {member(r.author_id)?.name || tr("成员")}
                                </strong>
                                <small>
                                  {project(r.project_id)?.name || tr("未归属")}
                                  <span> / </span>
                                  {reportDomains(r).join(" · ") || tr("未分类")}
                                </small>
                              </span>
                            </button>
                            <div className="report-content">
                              <div className="report-meta">
                                <Agent name={r.agent} />
                                <time>
                                  {clock(r.created_at, locale, timeZone)}
                                </time>
                                {(!seen[r.id] ||
                                  Date.parse(seen[r.id]) <
                                    Date.parse(r.updated_at)) && (
                                  <i
                                    className="unread-dot"
                                    title={tr("未读")}
                                  />
                                )}
                              </div>
                              <button
                                className="report-title"
                                onClick={() => markRead(r)}
                              >
                                {r.title}
                              </button>
                              <div className="todo-report-badges">
                                {(r.todo_ids || []).map((id) => {
                                  const task = todoIndex.find(
                                      (t) => t.id === id,
                                    ),
                                    column = todoColumns.find(
                                      (c) => c.id === task?.column_id,
                                    );
                                  return (
                                    <Link key={id} href={`/todo?todo=${id}`}>
                                      {task?.title || tr("任务详情")} ·{" "}
                                      {column
                                        ? defaultColumnName(column)
                                          ? tr(column.name)
                                          : column.name
                                        : tr("未完成")}
                                      {task?.archived
                                        ? ` · ${tr("已归档")}`
                                        : ""}
                                    </Link>
                                  );
                                })}
                              </div>
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
                                    {l.title || tr("交付链接")}
                                  </a>
                                ))}
                              </div>
                            </div>
                            <div className="report-state">
                              <Status value={r.status} />
                              <button onClick={() => markRead(r)}>
                                <MessageCircle size={14} />
                                {tr("{count} 条评论", {
                                  count: r.comments.length,
                                })}
                                {collaborations.some(
                                  (c) =>
                                    c.report_id === r.id &&
                                    !c.todo_id &&
                                    !["done", "cancelled"].includes(c.status),
                                ) && <small>{tr("· 有待办协作")}</small>}
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
                      {tr("需要关注")}
                      <span>{needs.length}</span>
                    </h2>
                    <button
                      aria-label={tr("筛选全部待关注事项")}
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
                            {member(r.author_id)?.name} ·{" "}
                            {clock(r.created_at, locale, timeZone)}
                          </small>
                        </span>
                        <ChevronDown size={14} />
                      </button>
                    ))
                  ) : (
                    <p className="muted text-sm">
                      {tr("当前没有阻塞或待反馈事项。")}
                    </p>
                  )}
                </section>
                <section className="rail-card">
                  <div className="rail-title">
                    <h2>{tr("进行中的项目")}</h2>
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
                      {tr("团队")}
                      <span>
                        ·{" "}
                        {tr("{count} 人", {
                          count: meta?.members.length || 5,
                        })}
                      </span>
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
                            ? tr("管理员")
                            : m.role === "member"
                              ? tr("成员")
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
                      {publicDemo
                        ? tr("公开演示 · 全部为虚拟数据")
                        : tr("本地演示 · 示例人物与交付链接")}
                      <br />
                      {publicDemo
                        ? tr("不连接真实服务，不保存到服务器")
                        : tr("上报及评论会保存在本机")}
                    </>
                  ) : (
                    <>
                      {tr("团队数据由 PostgreSQL 持久化")}
                      <br />
                      {tr("每 30 秒同步进展")}
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
          <DialogTitle className="sr-only">{tr("工作空间导航")}</DialogTitle>
          <DialogDescription className="sr-only">
            {tr("导航与团队工具")}
          </DialogDescription>
          {navigation}
        </DialogContent>
      </Dialog>
      <Dialog open={mobileFilters} onOpenChange={setMobileFilters}>
        <DialogContent className="filter-dialog">
          <DialogTitle className="modal-title">{tr("筛选动态")}</DialogTitle>
          <DialogDescription className="modal-description">
            {tr("筛选本页的来源、日期与关注范围。")}
          </DialogDescription>
          <div className="mobile-filter-fields">{filtersContent}</div>
          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={resetFilters}>
              {tr("重置本页")}
            </Button>
            <Button className="flex-1" onClick={() => setMobileFilters(false)}>
              {tr("查看")}
              {tr("{count} 条动态", {
                count: filtered.length,
              })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="info-dialog trash-dialog">
          <DialogTitle className="modal-title">{tr("已删除简报")}</DialogTitle>
          <DialogDescription className="sr-only">
            {tr("恢复自己或有权管理的简报")}
          </DialogDescription>
          {trashOpen && (
            <TrashList
              key={meta?.team.id}
              onRestored={() => {
                void load();
                setNotice("简报已恢复");
              }}
            />
          )}
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
            <ReportDetail
              key={selected.id}
              report={selected}
              collaborations={collaborations.filter(
                (c) => c.report_id === selected.id,
              )}
              meta={meta}
              onChange={() => void load()}
              onSaved={setNotice}
              onDeleted={() => {
                setDetail(null);
                void load();
                setNotice("简报已移至回收站");
              }}
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
          {tr(notice)}
        </div>
      )}
    </div>
  );
}
