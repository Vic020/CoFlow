"use client";
import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  Meta,
  Report,
  reportDomains,
  request,
  statuses,
} from "@/lib/types";

export function ReportCompose({
  meta,
  onDone,
  report,
  onCancel,
  onStale,
}: {
  meta: Meta;
  onDone: () => void;
  report?: Report;
  onCancel?: () => void;
  onStale?: () => void;
}) {
  const [title, setTitle] = useState(report?.title || ""),
    [body, setBody] = useState(report?.body || ""),
    [project, setProject] = useState(
      report
        ? meta.mode === "local-demo"
          ? report.project_id
          : meta.projects.find((p) => p.id === report.project_id)?.name ||
            report.project_id
        : "",
    ),
    [domain, setDomain] = useState(
      report ? reportDomains(report).join("，") : "",
    ),
    [agent, setAgent] = useState(report?.agent || "手动上报"),
    [status, setStatus] = useState(report?.status || "progress"),
    [mentions, setMentions] = useState<string[]>(report?.mentions || []),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [expectedUpdatedAt] = useState(report?.updated_at);
  const [links, setLinks] = useState(() =>
    (report?.links.length ? report.links : [{ title: "", url: "" }]).map(
      (l) => ({ ...l, key: crypto.randomUUID() }),
    ),
  );
  const [sourceId] = useState(() => crypto.randomUUID());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request(report ? `/reports/${report.id}` : "/reports", {
        method: report ? "PUT" : "POST",
        body: JSON.stringify({
          source_id: report?.source_id || sourceId,
          expected_updated_at: expectedUpdatedAt,
          title,
          body,
          project_id:
            meta.mode === "local-demo"
              ? project
              : meta.projects.find(
                  (p) => p.id === project || p.name === project,
                )?.id || "",
          project_name:
            meta.mode !== "local-demo" &&
            !meta.projects.some((p) => p.id === project || p.name === project)
              ? project
              : undefined,
          domain: meta.mode === "local-demo" ? domain : undefined,
          domains:
            meta.mode !== "local-demo"
              ? domain
                  .split(/[,，]/)
                  .map((x) => x.trim())
                  .filter(Boolean)
              : undefined,
          agent,
          status,
          links: links
            .filter((l) => l.url.trim() || l.title.trim())
            .map((l) => ({
              title: l.title.trim() || "交付链接",
              url: l.url.trim(),
            })),
          mentions,
        }),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) onStale?.();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
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
            {meta.mode === "local-demo" ? (
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
            ) : (
              <>
                <input
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  list="compose-projects"
                  placeholder="选择或输入新项目，可留空"
                  maxLength={40}
                />
                <datalist id="compose-projects">
                  {meta.projects
                    .filter((p) => p.status !== "archived")
                    .map((p) => (
                      <option key={p.id} value={p.name} />
                    ))}
                </datalist>
              </>
            )}
          </label>
          <label>
            工作领域
            {meta.mode === "local-demo" ? (
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              >
                <option value="">未分类</option>
                {meta.domains.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            ) : (
              <>
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  list="compose-domains"
                  placeholder="如：研发，产品"
                  maxLength={500}
                />
                <datalist id="compose-domains">
                  {meta.domains.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </>
            )}
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
            <select
              disabled={!!report}
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
            >
              {Array.from(
                new Set([
                  agent,
                  "手动上报",
                  "Codex",
                  "Claude Code",
                  "其他 Agent",
                ]),
              ).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="report-links-editor">
          <legend>交付链接</legend>
          {links.map((entry, index) => (
            <div className="report-link-row" key={entry.key}>
              <div className="report-link-fields">
                <input
                  type="url"
                  aria-label={`链接 ${index + 1} 地址`}
                  placeholder="https://…"
                  value={entry.url}
                  required={!!entry.title.trim()}
                  onChange={(e) =>
                    setLinks(
                      links.map((l) =>
                        l.key === entry.key ? { ...l, url: e.target.value } : l,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`链接 ${index + 1} 名称`}
                  placeholder="链接名称（可选）"
                  maxLength={100}
                  value={entry.title}
                  onChange={(e) =>
                    setLinks(
                      links.map((l) =>
                        l.key === entry.key
                          ? { ...l, title: e.target.value }
                          : l,
                      ),
                    )
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`移除链接 ${index + 1}`}
                onClick={() =>
                  setLinks(links.filter((l) => l.key !== entry.key))
                }
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={links.length >= 20}
            onClick={() =>
              setLinks([
                ...links,
                { key: crypto.randomUUID(), title: "", url: "" },
              ])
            }
          >
            <Plus />
            添加链接{links.length >= 20 ? "（最多 20 个）" : ""}
          </Button>
        </fieldset>
        {meta.members.some(
          (m) => m.id !== meta.current_user || mentions.includes(m.id),
        ) && (
          <fieldset className="report-mentions-editor">
            <legend>需要谁关注</legend>
            <div className="report-mention-options">
              {meta.members
                .filter(
                  (m) => m.id !== meta.current_user || mentions.includes(m.id),
                )
                .map((m) => (
                  <label key={m.id}>
                    <input
                      type="checkbox"
                      checked={mentions.includes(m.id)}
                      onChange={(e) =>
                        setMentions(
                          e.target.checked
                            ? [...mentions, m.id]
                            : mentions.filter((id) => id !== m.id),
                        )
                      }
                    />
                    {m.name}
                  </label>
                ))}
            </div>
          </fieldset>
        )}
      </div>
      <div className="compose-footer">
        <span
          className={error ? "error-text" : "compose-author"}
          role={error ? "alert" : undefined}
        >
          {error ||
            `以${meta.members.find((m) => m.id === meta.current_user)?.name || "当前成员"}的身份${report ? "保存" : "发布"}${meta.mode === "local-demo" ? " · 本地演示" : ""}`}
        </span>
        <div className="compose-submit-actions">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onCancel}
            >
              取消
            </Button>
          )}
          <Button type="submit" disabled={busy || !title.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            {report ? "保存修改" : "发布进展"}
          </Button>
        </div>
      </div>
    </form>
  );
}
