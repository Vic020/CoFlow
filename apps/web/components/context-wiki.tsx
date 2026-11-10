"use client";
import { ContextAIAction } from "./context-ai-action";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  ChevronLeft,
  FileText,
  Plus,
  ChevronRight,
} from "lucide-react";
import { ContentSkeleton } from "./ui/loading-status";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import {
  contextKinds,
  contextStates,
  type ContextEntry,
  type ContextNode,
  wikiIntroduction,
} from "@/lib/context";
import type { Meta } from "@/lib/types";

export function ContextDirectory({
  nodes,
  loading,
  meta,
  project,
  domain,
  selected,
  onOpen,
  onCreate,
}: {
  nodes: ContextNode[];
  loading: boolean;
  meta: Meta;
  project: string;
  domain: string;
  selected: string;
  onOpen: (id: string) => void;
  onCreate: (v: ContextEntry) => void;
}) {
  const { t: tr } = useI18n();
  const [group, setGroup] = useState<"project" | "domain">("project");
  const groups =
    group === "project"
      ? [
          ...meta.projects
            .filter((p) => !project || p.id === project)
            .map((p) => ({
              id: p.id,
              name: p.name,
              items: nodes.filter((n) => n.project_id === p.id),
              project: p.id,
              domains: domain ? [domain] : [],
            })),
          ...(!project
            ? [
                {
                  id: "",
                  name: tr("团队知识"),
                  items: nodes.filter((n) => !n.project_id),
                  project: "",
                  domains: domain ? [domain] : [],
                },
              ]
            : []),
        ]
      : meta.domains
          .filter((d) => !domain || d === domain)
          .map((d) => ({
            id: d,
            name: d,
            items: nodes.filter((n) => n.domains.includes(d)),
            project,
            domains: [d],
          }));
  function branch(xs: ContextNode[], parent = "", depth = 0): React.ReactNode {
    if (depth >= 12) return null;
    const ids = new Set(xs.map((x) => x.id));
    return (
      <ul>
        {xs
          .filter((x) =>
            parent
              ? x.parent_id === parent
              : !x.parent_id || !ids.has(x.parent_id),
          )
          .map((x) => {
            const children = xs.some((n) => n.parent_id === x.id);
            const button = (
              <button
                className={selected === x.id ? "active" : ""}
                onClick={() => onOpen(x.id)}
                title={x.title}
                aria-current={selected === x.id ? "page" : undefined}
              >
                <FileText size={14} />
                <span>{x.title}</span>
                {x.needs_review && <i aria-label={tr("需复核")} />}
              </button>
            );
            return (
              <li key={x.id}>
                {children ? (
                  <details open>
                    <summary>
                      <ChevronRight
                        className="context-directory-chevron"
                        size={12}
                      />
                      {button}
                    </summary>
                    {branch(xs, x.id, depth + 1)}
                  </details>
                ) : (
                  button
                )}
              </li>
            );
          })}
      </ul>
    );
  }
  return (
    <aside className="context-directory">
      <div className="context-directory-heading">
        <BookOpen size={15} />
        <strong>{tr("目录")}</strong>
      </div>
      <div
        className="view-tabs context-directory-tabs"
        aria-label={tr("目录分组")}
      >
        {(
          [
            ["project", "项目"],
            ["domain", "领域"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            aria-pressed={group === v}
            className={group === v ? "active" : ""}
            onClick={() => setGroup(v)}
          >
            {tr(label)}
          </button>
        ))}
      </div>
      {loading ? (
        <ContentSkeleton rows={3} />
      ) : (
        <nav aria-label={tr("Context 目录")}>
          {groups.map((g) => (
            <details open key={g.id} className="context-directory-group">
              <summary>
                <span title={g.name}>{g.name}</span>
                <span className="context-directory-actions">
                  <ContextAIAction
                    contextTitles={Object.fromEntries(
                      g.items.map((n) => [n.id, n.title]),
                    )}
                    contextIDs={g.items
                      .filter((n) => n.state !== "archived")
                      .map((n) => n.id)}
                    label="AI 整理"
                    variant="ghost"
                    size="icon"
                    scope={{
                      project: g.project,
                      domain: g.domains[0],
                      mode: "organize",
                    }}
                  />
                  <button
                    title={tr("新建介绍文档")}
                    aria-label={`${tr("新建介绍文档")}: ${g.name}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onCreate(
                        wikiIntroduction(g.name, g.project, g.domains, tr),
                      );
                    }}
                  >
                    <Plus size={14} />
                  </button>
                </span>
              </summary>
              {branch(g.items.filter((n) => n.state !== "archived"))}
              {!g.items.some((n) => n.state !== "archived") && (
                <p className="muted context-directory-empty">
                  {tr("暂无文档")}
                </p>
              )}
            </details>
          ))}
        </nav>
      )}
    </aside>
  );
}

export function ContextDocument({
  value,
  nodes,
  meta,
  onBack,
  onManage,
  onChild,
  onOpen,
}: {
  value: ContextEntry;
  nodes: ContextNode[];
  meta: Meta;
  onBack: () => void;
  onManage: (edit: boolean) => void;
  onChild: () => void;
  onOpen: (id: string) => void;
}) {
  const { t: tr, date } = useI18n();
  const writable =
    value.creator_id === meta.current_user ||
    (value.visibility === "team" && meta.role === "admin");
  return (
    <article className="context-document">
      <div className="context-document-actions">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ChevronLeft size={14} />
          {tr("返回列表")}
        </Button>
        <div>
          <ContextAIAction
            contextTitles={{ [value.id]: value.title }}
            label="AI 整理"
            variant="outline"
            size="sm"
            scope={{
              source_kind: "context",
              source_id: value.id,
              mode: "organize",
            }}
          />
          {writable && (
            <Button size="sm" variant="outline" onClick={() => onManage(true)}>
              {tr("编辑")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onManage(false)}>
            {tr("详情")}
          </Button>
          {["document", "index"].includes(value.kind) && (
            <Button size="sm" variant="ghost" onClick={onChild}>
              <Plus size={14} />
              {tr("子文档")}
            </Button>
          )}
        </div>
      </div>
      <header>
        <h2>{value.title}</h2>
        <div className="context-meta">
          <span className="context-state" data-state={value.state}>
            {tr(contextStates[value.state])}
          </span>
          <span>{tr(contextKinds[value.kind])}</span>
          <span>{date(value.updated_at)}</span>
          {value.visibility === "personal" && <span>{tr("仅自己")}</span>}
          {value.needs_review && (
            <span className="context-warning">{tr("需复核")}</span>
          )}
        </div>
      </header>
      <div className="markdown-body context-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            img: ({ alt }) => <span>{alt}</span>,
            a: ({ href, children }) => (
              <a
                href={href}
                onClick={(e) => {
                  if (href?.startsWith("/context?")) {
                    const id = new URL(
                      href,
                      "https://local.invalid",
                    ).searchParams.get("context");
                    if (id) {
                      e.preventDefault();
                      onOpen(id);
                    }
                  }
                }}
              >
                {children}
              </a>
            ),
          }}
        >
          {value.body}
        </ReactMarkdown>
      </div>
      {nodes.some((n) => n.reference_ids?.includes(value.id)) && (
        <section className="context-document-sources">
          <h3>{tr("引用此页")}</h3>
          {nodes
            .filter((n) => n.reference_ids?.includes(value.id))
            .map((n) => (
              <button
                className="context-backlink"
                key={n.id}
                onClick={() => onOpen(n.id)}
              >
                {n.title}
              </button>
            ))}
        </section>
      )}
      {value.sources.length > 0 && (
        <footer className="context-document-sources">
          <h3>{tr("来源")}</h3>
          {value.sources.map((s) => (
            <div className="context-source" key={s.kind + s.id}>
              <a
                href={s.url}
                onClick={(e) => {
                  if (s.kind === "context") {
                    e.preventDefault();
                    onOpen(s.id);
                  }
                }}
              >
                {s.kind === "context"
                  ? "Context"
                  : s.kind === "report"
                    ? "Timeline"
                    : s.kind === "todo"
                      ? "Todo"
                      : "Calendar"}{" "}
                · {s.id}
              </a>
              {s.quote && <blockquote>{s.quote}</blockquote>}
              {(s.changed || s.archived || s.needs_review) && (
                <small className="context-warning">{tr("需复核")}</small>
              )}
            </div>
          ))}
        </footer>
      )}
    </article>
  );
}
