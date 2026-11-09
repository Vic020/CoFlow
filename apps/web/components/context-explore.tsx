"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  Check,
  Compass,
  FileText,
  FolderOpen,
  Layers,
  Plus,
  BookOpen,
} from "lucide-react";
import { useI18n } from "./i18n-provider";
import { useSharedFilters } from "./shared-filters";
import { ContextAIAction } from "./context-ai-action";
import { Button } from "./ui/button";
import { ContentSkeleton, LoadingStatus } from "./ui/loading-status";
import { request, ApiError, type Meta } from "@/lib/types";
import {
  blankContext,
  contextKinds,
  contextStates,
  type ContextEntry,
  type ContextNode,
} from "@/lib/context";
import {
  exploreTopics,
  explorePath,
  exploreChildren,
  exploreDescendants,
} from "@/lib/context-explore";

export function ContextExploreView({
  nodes,
  meta,
  matchingIDs,
  onRead,
  onCreate,
}: {
  nodes: ContextNode[];
  meta: Meta;
  matchingIDs: string[] | null;
  onRead: (id: string) => void;
  onCreate: (value: ContextEntry) => void;
}) {
  const { t: tr } = useI18n(),
    shared = useSharedFilters(),
    params = useSearchParams();
  const topics = useMemo(
    () => exploreTopics(nodes, meta, matchingIDs),
    [nodes, meta, matchingIDs],
  );
  const [location, setLocation] = useState({
    topic: params.get("explore_topic") || "",
    node: params.get("explore_node") || "",
  });
  const [visited, setVisited] = useState(new Set<string>()),
    [limit, setLimit] = useState(8);
  const [preview, setPreview] = useState<ContextEntry | null>(null),
    [reading, setReading] = useState(false),
    [error, setError] = useState(""),
    [readVersion, setReadVersion] = useState(0);
  const seq = useRef(0);
  const topic = topics.find((t) => t.key === location.topic);
  const path = topic ? explorePath(topic, location.node) : [];
  const current = path.at(-1);
  const branches = topic ? exploreChildren(topic, current?.id) : [];
  const total = topic
    ? topic.matches.size
    : new Set(topics.flatMap((t) => [...t.matches])).size;
  const readCount = new Set(
    (topic ? [...topic.matches] : topics.flatMap((t) => [...t.matches])).filter(
      (id) => visited.has(id),
    ),
  ).size;
  useEffect(() => {
    setLocation({
      topic: params.get("explore_topic") || "",
      node: params.get("explore_node") || "",
    });
  }, [params]);
  useEffect(() => {
    setLimit(8);
  }, [location.topic, location.node]);
  function navigate(topicKey = "", id = "") {
    if (topicKey === location.topic && id === location.node) return;
    setLocation({ topic: topicKey, node: id });
    const url = new URL(window.location.href);
    topicKey
      ? url.searchParams.set("explore_topic", topicKey)
      : url.searchParams.delete("explore_topic");
    id
      ? url.searchParams.set("explore_node", id)
      : url.searchParams.delete("explore_node");
    window.history.pushState(null, "", url.pathname + url.search);
  }
  useEffect(() => {
    const id = current?.id;
    seq.current++;
    if (!id) {
      setPreview(null);
      setReading(false);
      setError("");
      return;
    }
    let active = true;
    const read = async () => {
      const n = ++seq.current;
      setReading(true);
      try {
        const v = await request<ContextEntry>(
          "/context/" + encodeURIComponent(id),
        );
        if (active && n === seq.current) {
          setPreview(v);
          setError("");
          setVisited((old) => new Set(old).add(id));
        }
      } catch (e) {
        if (active && n === seq.current) {
          setError((e as Error).message);
          if (e instanceof ApiError && (e.status === 403 || e.status === 404))
            setPreview(null);
        }
      } finally {
        if (active && n === seq.current) setReading(false);
      }
    };
    void read();
    window.addEventListener("focus", read);
    window.addEventListener("coflow-knowledge-change", read);
    return () => {
      active = false;
      window.removeEventListener("focus", read);
      window.removeEventListener("coflow-knowledge-change", read);
    };
  }, [current?.id, current?.revision, current?.needs_review, readVersion]);
  const readable = current && preview?.id === current.id ? preview : null;
  const title = topic
    ? current?.title || (topic.kind === "team" ? tr("团队知识") : topic.title)
    : tr("从主题开始探索");
  const scope = current
    ? {
        source_kind: "context",
        source_id: current.id,
        member: shared.filters.member,
        mode: "organize" as const,
      }
    : {
        project: topic?.project || shared.filters.project,
        domain: topic?.domain || shared.filters.domain,
        member: shared.filters.member,
        mode: "organize" as const,
      };
  const depth = current ? path.length + 1 : topic ? 1 : 0;
  const branchCount = topic ? Math.min(limit, branches.length) : topics.length;
  const branchWidth =
    Math.max(1, Math.min(3, branchCount)) * 280 +
    Math.max(0, Math.min(3, branchCount) - 1) * 24;
  function child() {
    const base = blankContext();
    onCreate({
      ...base,
      kind: "document",
      parent_id: current?.id || "",
      project_id:
        current?.project_id || topic?.project || shared.filters.project,
      domains:
        current?.domains ||
        (topic?.domain
          ? [topic.domain]
          : shared.filters.domain
            ? [shared.filters.domain]
            : []),
      visibility: current?.visibility || "team",
    });
  }
  return (
    <section className="context-explore" aria-label={tr("知识探索")}>
      <div className="context-explore-toolbar">
        <nav aria-label={tr("探索路径")}>
          <button onClick={() => navigate()}>
            <Compass size={14} />
            {tr("全部主题")}
          </button>
          {topic && (
            <>
              <span>/</span>
              <button
                aria-current={!current ? "page" : undefined}
                onClick={() => navigate(topic.key)}
              >
                {topic.kind === "team" ? tr("团队知识") : topic.title}
              </button>
            </>
          )}
          {path.map((n, i) => (
            <span className="context-explore-crumb" key={n.id}>
              <span>/</span>
              <button
                aria-current={i === path.length - 1 ? "page" : undefined}
                onClick={() => navigate(topic!.key, n.id)}
              >
                {n.title}
              </button>
            </span>
          ))}
        </nav>
        <small>
          {tr("本次已浏览 {count}/{total}", { count: readCount, total })}
        </small>
      </div>
      <div className="context-explore-stage">
        <div className="context-explore-focus">
          <span className="context-explore-level">
            {topic ? tr("第 {level} 层", { level: depth }) : tr("探索起点")}
          </span>
          <h2>{title}</h2>
          <div className="context-meta">
            {current ? (
              <>
                <span>{tr(contextKinds[current.kind])}</span>
                <span>{tr(contextStates[current.state])}</span>
                {current.needs_review && (
                  <span className="context-warning">{tr("需复核")}</span>
                )}
              </>
            ) : (
              <span>
                {tr(
                  topic
                    ? "选择下方分支继续探索"
                    : "先选一个大主题，再一层层深入",
                )}
              </span>
            )}
          </div>
          <div className="context-explore-focus-actions">
            {topic && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  current
                    ? navigate(topic.key, path.at(-2)?.id || "")
                    : navigate()
                }
              >
                <ArrowLeft size={14} />
                {tr("返回上一层")}
              </Button>
            )}
            {current && (
              <Button
                variant="outline"
                size="sm"
                disabled={!!error && !readable}
                onClick={() => onRead(current.id)}
              >
                <BookOpen size={14} />
                {tr("阅读全文")}
              </Button>
            )}
            <ContextAIAction
              key={current?.id || topic?.key || "root"}
              label="AI 整理"
              variant="ghost"
              size="sm"
              scope={scope}
            />
            {topic &&
              (!current || ["document", "index"].includes(current.kind)) && (
                <Button variant="ghost" size="sm" onClick={child}>
                  <Plus size={14} />
                  {tr("新增分支")}
                </Button>
              )}
          </div>
        </div>
        {current && (
          <div className="context-explore-reading" aria-busy={reading}>
            <LoadingStatus active={reading && !!readable} />
            {error && (
              <div role="alert">
                <p>{tr(error)}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={reading}
                  onClick={() => setReadVersion((n) => n + 1)}
                >
                  {tr("重新读取")}
                </Button>
              </div>
            )}
            {!readable && reading ? (
              <ContentSkeleton rows={2} />
            ) : readable ? (
              <>
                <div className="markdown-body context-explore-preview">
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
                                if (topic?.nodes.some((n) => n.id === id))
                                  navigate(topic.key, id);
                                else onRead(id);
                              }
                            }
                          }}
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {readable.body}
                  </ReactMarkdown>
                </div>
                {readable.sources.length > 0 && (
                  <div className="context-explore-sources">
                    <span>{tr("来源")}</span>
                    {readable.sources.map((s) =>
                      s.kind === "context" ? (
                        <button
                          key={s.kind + s.id}
                          onClick={() => {
                            if (topic?.nodes.some((n) => n.id === s.id))
                              navigate(topic.key, s.id);
                            else onRead(s.id);
                          }}
                        >
                          {nodes.find((n) => n.id === s.id)?.title || "Context"}
                        </button>
                      ) : (
                        <Link
                          key={s.kind + s.id}
                          href={shared.href(
                            s.url ||
                              (s.kind === "todo"
                                ? "/todo?todo="
                                : s.kind === "report"
                                  ? "/?report="
                                  : "/calendar?event=") +
                                encodeURIComponent(s.id),
                          )}
                        >
                          {s.kind === "todo"
                            ? "Todo"
                            : s.kind === "report"
                              ? "Timeline"
                              : "Calendar"}
                        </Link>
                      ),
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
        {((!topic && topics.length > 0) ||
          (!!topic && branches.length > 0)) && (
          <div className="context-explore-connector">
            <ArrowDown size={16} />
          </div>
        )}
        {!topic ? (
          <div
            className="context-explore-branches"
            style={{ width: branchWidth }}
          >
            {topics.map((t) => (
              <button
                className="context-explore-node is-topic"
                key={t.key}
                onClick={() => navigate(t.key)}
              >
                <FolderOpen size={22} />
                <strong>{t.kind === "team" ? tr("团队知识") : t.title}</strong>
                <span>
                  {tr(
                    t.kind === "project"
                      ? "项目"
                      : t.kind === "domain"
                        ? "领域"
                        : "团队知识",
                  )}
                </span>
                <small>
                  {tr("{count} 条知识 · {branches} 个分支", {
                    count: t.matches.size,
                    branches: exploreChildren(t).length,
                  })}
                </small>
                <ArrowRight className="context-explore-enter" size={15} />
              </button>
            ))}
          </div>
        ) : (
          <div
            className="context-explore-branches"
            style={{ width: branchWidth }}
          >
            {branches.slice(0, limit).map((n) => {
              const count = exploreDescendants(topic, n.id).size - 1;
              return (
                <button
                  key={n.id}
                  className={`context-explore-node ${visited.has(n.id) ? "is-visited" : ""}`}
                  onClick={() => navigate(topic.key, n.id)}
                >
                  {count ? <Layers size={21} /> : <FileText size={21} />}
                  <strong>{n.title}</strong>
                  <span>{tr(contextKinds[n.kind])}</span>
                  <small>
                    {count
                      ? tr("{count} 个下级知识点", { count })
                      : tr("知识节点")}
                  </small>
                  {visited.has(n.id) ? (
                    <span className="context-explore-visited">
                      <Check size={12} />
                      {tr("已浏览")}
                    </span>
                  ) : (
                    <ArrowRight className="context-explore-enter" size={15} />
                  )}
                </button>
              );
            })}
          </div>
        )}
        {topic && branches.length > limit && (
          <Button
            className="context-explore-more"
            variant="ghost"
            size="sm"
            onClick={() => setLimit((n) => n + 8)}
          >
            {tr("继续展开本层分支")}
          </Button>
        )}
        {topic && current && !branches.length && (
          <p className="context-explore-leaf">
            {tr("已到当前分支末端，可返回上一层探索其他方向")}
          </p>
        )}
        {!topics.length && (
          <p className="context-explore-leaf">
            {tr("当前范围暂无可探索的主题")}
          </p>
        )}
      </div>
    </section>
  );
}
