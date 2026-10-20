"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  Terminal,
  Users,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { AgentAccess } from "@/components/agent-access";
import { AgentConnectCard } from "@/components/agent-connect-card";
import { CoFlowLogo } from "@/components/coflow-logo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
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
      <span>{label}：</span>
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

export default function Home() {
  const [meta, setMeta] = useState<Meta | null>(null),
    [reports, setReports] = useState<Report[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters),
    [query, setQuery] = useState(""),
    [view, setView] = useState("all"),
    [mine, setMine] = useState(false),
    [unread, setUnread] = useState(false);
  const [seen, setSeen] = useState<Record<string, string>>({}),
    [detail, setDetail] = useState<string | null>(null),
    [compose, setCompose] = useState(false),
    [access, setAccess] = useState(false),
    [settings, setSettings] = useState(false),
    [nav, setNav] = useState(false),
    [mobileFilters, setMobileFilters] = useState(false),
    [attention, setAttention] = useState(false),
    [onlyAttention, setOnlyAttention] = useState(false),
    [notice, setNotice] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  function toggleSidebar() {
    setSidebarCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem("coflow-sidebar-collapsed", String(next));
      } catch {}
      return next;
    });
  }
  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const [m, r] = await Promise.all([
        request<Meta>("/meta"),
        request<{ items: Report[] }>("/reports"),
      ]);
      setMeta(m);
      setReports(r.items);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(true);
    try {
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
    setSeen((prev) => {
      const next = { ...prev, [r.id]: r.updated_at };
      localStorage.setItem("coflow-seen", JSON.stringify(next));
      return next;
    });
  };
  const updateFilter = (key: keyof Filters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));
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
        (!filters.domain || r.domain === filters.domain) &&
        (!filters.member || r.author_id === filters.member) &&
        (!filters.agent || r.agent === filters.agent) &&
        new Date(r.created_at).getTime() >= cutoff &&
        (!mine ||
          r.author_id === meta?.current_user ||
          r.mentions.includes(meta?.current_user || "")) &&
        (!unread || seen[r.id] !== r.updated_at) &&
        (!onlyAttention || ["blocked", "review"].includes(r.status)) &&
        (!query ||
          [
            r.title,
            r.body,
            r.agent,
            r.domain,
            meta?.members.find((m) => m.id === r.author_id)?.name,
            meta?.projects.find((p) => p.id === r.project_id)?.name,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase())),
    );
  }, [reports, filters, mine, unread, seen, query, meta, onlyAttention]);
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
  const activeFilters = Object.entries(filters).filter(
    ([k, v]) => v !== initialFilters[k as keyof Filters],
  ).length;
  const filtersContent = (
    <>
      <SelectFilter
        label="项目"
        value={filters.project}
        onChange={(v) => updateFilter("project", v)}
        options={meta?.projects || []}
      />
      <SelectFilter
        label="领域"
        value={filters.domain}
        onChange={(v) => updateFilter("domain", v)}
        options={(meta?.domains || []).map((d) => ({ id: d, name: d }))}
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
        <span>日期：</span>
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
    </>
  );
  const navigation = (
    <>
      <div className="brand-row">
        {sidebarCollapsed && !nav ? (
          <button className="brand brand-expand" aria-label="点击 Logo 展开侧边栏"
            title="展开侧边栏" aria-expanded={false} onClick={toggleSidebar}>
            <CoFlowLogo />
          </button>
        ) : (
          <div className="brand"><CoFlowLogo /><span>CoFlow</span></div>
        )}
        {!sidebarCollapsed && (
          <Button className="sidebar-toggle" variant="ghost" size="icon"
            aria-label="收起侧边栏" title="收起侧边栏" aria-expanded={true} onClick={toggleSidebar}>
            <ChevronLeft />
          </Button>
        )}
      </div>
      <div className="workspace" title="共创团队">
        <Users size={17} />
        <strong>共创团队</strong>
        <span className="demo-tag">演示</span>
      </div>
      <nav>
        <button
          className="nav-active"
          aria-label="Timeline"
          title="Timeline"
          onClick={() => {
            setFilters(initialFilters);
            setOnlyAttention(false);
            setQuery("");
            setNav(false);
          }}
        >
          <Clock3 size={18} />
          <span className="nav-label">Timeline</span>
        </button>
      </nav>
      <div className="nav-bottom">
        <button
          aria-label="Agent 接入"
          title="Agent 接入"
          onClick={() => {
            setAccess(true);
            setNav(false);
          }}
        >
          <Terminal size={18} />
          <span className="nav-label">Agent 接入</span>
        </button>
        <button
          aria-label="团队设置"
          title="团队设置"
          onClick={() => {
            setSettings(true);
            setNav(false);
          }}
        >
          <Settings2 size={18} />
          <span className="nav-label">团队设置</span>
        </button>
        <div className="profile">
          <Avatar member={member("chen")} small />
          <div>
            <strong>陈一</strong>
            <small>本地演示身份</small>
          </div>
          <span className="online-dot" />
        </div>
      </div>
    </>
  );
  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">{navigation}</aside>
      <main className="main-shell">
        <div className="workspace-content">
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
                  团队动态
                  <span className="heading-dot" />
                </h1>
                <div className="heading-context">
                  <nav className="breadcrumb" aria-label="面包屑">
                    <span>工作空间</span>
                    <span aria-hidden="true">/</span>
                    <strong>Timeline</strong>
                  </nav>
                  <span className="heading-caption">
                    每一次推进，都在这里汇合。
                  </span>
                </div>
              </div>
            </div>
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
              <Button onClick={() => setCompose(true)}>
                <Plus />
                <span>上报</span>
              </Button>
            </div>
          </header>
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
              <div className="view-toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={mine}
                    onChange={(e) => setMine(e.target.checked)}
                  />
                  与我相关
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={unread}
                    onChange={(e) => setUnread(e.target.checked)}
                  />
                  只看未读
                </label>
              </div>
            </div>
            <div className="desktop-filters">{filtersContent}</div>
            <div className="mobile-filter-bar">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMobileFilters(true)}
              >
                <Filter />
                筛选{activeFilters ? ` · ${activeFilters}` : ""}
              </Button>
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
            {(activeFilters > 0 || onlyAttention || query) && (
              <div className="filter-summary">
                <span>
                  当前显示 {filtered.length} 条{onlyAttention ? "待关注" : ""}
                  动态
                </span>
                <button
                  onClick={() => {
                    setFilters(initialFilters);
                    setOnlyAttention(false);
                    setQuery("");
                  }}
                >
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
              <ChevronDown size={16} className={attention ? "rotated" : ""} />
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
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilters(initialFilters);
                    setMine(false);
                    setUnread(false);
                    setOnlyAttention(false);
                    setQuery("");
                  }}
                >
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
                  {view === "daily" ? (
                    <div className="daily-list">
                      {(meta?.members || []).map((m) => {
                        const items = rows.filter((r) => r.author_id === m.id);
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
                              <button key={r.id} onClick={() => markRead(r)}>
                                <Status value={r.status} />
                                <strong>{r.title}</strong>
                                <span className="daily-project">
                                  {project(r.project_id)?.name || "未归属"}
                                </span>
                                <MessageCircle size={13} />
                                <span>{r.comments.length}</span>
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
                          onClick={() => updateFilter("member", r.author_id)}
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
                              {r.domain || "未分类"}
                            </small>
                          </span>
                        </button>
                        <div className="report-content">
                          <div className="report-meta">
                            <Agent name={r.agent} />
                            <time>{clock(r.created_at)}</time>
                            {seen[r.id] !== r.updated_at && (
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
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </section>
              ))
            )}
            <footer className="feed-footer">
              <span className="online-dot" />
              进展有迹，协作有回应<span>Asia/Shanghai</span>
            </footer>
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
                    <i className={r.status === "blocked" ? "red" : "amber"} />
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
                  {meta?.projects.length || 0}
                </span>
              </div>
              {meta?.projects.map((p, i) => (
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
                      p.status === "进行中" ? "online-dot" : "planned-dot"
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
                    <small>{m.role}</small>
                  </button>
                ))}
              </div>
            </section>
            <AgentConnectCard onMore={() => setAccess(true)} />
            <p className="demo-note">
              本地演示 · 示例人物与交付链接
              <br />
              上报及评论会保存在本机
            </p>
          </aside>
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
          <div className="mobile-filter-fields">{filtersContent}</div>
          <div className="flex gap-3 mt-6">
            <Button
              variant="outline"
              onClick={() => setFilters(initialFilters)}
            >
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
              report={selected}
              meta={meta}
              onChange={() => void load()}
              onSaved={setNotice}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={compose} onOpenChange={setCompose}>
        <DialogContent className="compose-dialog">
          {meta && (
            <Compose
              meta={meta}
              onDone={() => {
                setCompose(false);
                setNotice("进展已同步到 Timeline");
                void load();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={access} onOpenChange={setAccess}>
        <DialogContent className="info-dialog">
          <AgentAccess />
        </DialogContent>
      </Dialog>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="info-dialog">
          <DialogTitle className="modal-title">共创团队 · 项目设置</DialogTitle>
          <DialogDescription className="modal-description">
            当前为第一阶段的本地交互演示。
          </DialogDescription>
          <dl className="settings-list">
            <div>
              <dt>团队人数</dt>
              <dd>5 人 · 示例数据</dd>
            </div>
            <div>
              <dt>团队时区</dt>
              <dd>Asia/Shanghai</dd>
            </div>
            <div>
              <dt>同步方式</dt>
              <dd>每 30 秒刷新，可主动上报</dd>
            </div>
            <div>
              <dt>持久化</dt>
              <dd>本地文件，或配置 PostgreSQL</dd>
            </div>
          </dl>
          <div className="info-callout">
            正式账号、邀请成员、创建项目、维护领域与个人接入凭证属于下一阶段。目前不开放公网部署。
          </div>
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
  meta,
  onChange,
  onSaved,
}: {
  report: Report;
  meta: Meta;
  onChange: () => void;
  onSaved: (s: string) => void;
}) {
  const [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const author = meta.members.find((m) => m.id === r.author_id);
  async function comment(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      await request(`/reports/${r.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setBody("");
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
          {r.domain || "未分类"} · {dateKey(r.created_at)}
        </DialogDescription>
        <div className="detail-status">
          <Status value={r.status} />
          {r.author_id === meta.current_user &&
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
        <label htmlFor="comment-body">以陈一的身份回复</label>
        <textarea
          id="comment-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="分享反馈或协作建议，支持 Markdown…"
          rows={3}
          maxLength={4000}
        />
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
function Compose({ meta, onDone }: { meta: Meta; onDone: () => void }) {
  const [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [project, setProject] = useState(""),
    [domain, setDomain] = useState(""),
    [agent, setAgent] = useState("手动上报"),
    [status, setStatus] = useState("progress"),
    [linkTitle, setLinkTitle] = useState(""),
    [link, setLink] = useState(""),
    [mention, setMention] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [sourceId] = useState(() => crypto.randomUUID());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request("/reports", {
        method: "POST",
        body: JSON.stringify({
          source_id: sourceId,
          title,
          body,
          project_id: project,
          domain,
          agent,
          status,
          links: link ? [{ title: linkTitle || "交付链接", url: link }] : [],
          mentions: mention ? [mention] : [],
        }),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <DialogTitle className="modal-title">同步工作进展</DialogTitle>
      <DialogDescription className="modal-description">
        写下结果，附上交付链接，让协作继续向前。
      </DialogDescription>
      <div className="compose-fields">
        <label>
          简报标题 <span>*</span>
          <input
            autoFocus
            required
            maxLength={150}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="这次完成了什么？"
          />
        </label>
        <label>
          进展说明
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={15000}
            placeholder="结果、关键变化，以及需要团队协助的地方… 支持 Markdown"
          />
        </label>
        <div className="form-grid">
          <label>
            所属项目
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">未归属</option>
              {meta.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            工作领域
            <select value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="">未分类</option>
              {meta.domains.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            进展状态
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(statuses).map(([s, o]) => (
                <option key={s} value={s}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            来源 Agent
            <select value={agent} onChange={(e) => setAgent(e.target.value)}>
              {["手动上报", "Codex", "Claude Code", "其他 Agent"].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          交付链接
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://…"
          />
          {link && (
            <input
              value={linkTitle}
              onChange={(e) => setLinkTitle(e.target.value)}
              placeholder="链接名称，如：在线预览、PR、设计稿"
              maxLength={100}
            />
          )}
        </label>
        <label>
          需要谁关注
          <select value={mention} onChange={(e) => setMention(e.target.value)}>
            <option value="">暂不指定</option>
            {meta.members
              .filter((m) => m.id !== meta.current_user)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="compose-footer">
        <span className="error-text" role="alert">
          {error || "本地演示 · 以陈一的身份发布"}
        </span>
        <Button type="submit" disabled={busy || !title.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />}发布进展
        </Button>
      </div>
    </form>
  );
}
