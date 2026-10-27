"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pencil, ExternalLink, Plus, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import type { Meta } from "@/lib/types";
import type { Todo } from "@/lib/todo";

type Field =
  | "title"
  | "assignee_id"
  | "priority"
  | "project_id"
  | "due_date"
  | "domains"
  | "body"
  | "links";

function DetailField({
  name,
  label,
  view,
  active,
  writable,
  busy,
  onEdit,
  onCancel,
  onSave,
  children,
}: {
  name: Field;
  label: string;
  view: ReactNode;
  active: boolean;
  writable: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => Promise<void>;
  children: ReactNode;
}) {
  const { t: tr } = useI18n();
  const pencil = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(active);
  useEffect(() => {
    if (wasEditing.current && !active) pencil.current?.focus();
    wasEditing.current = active;
  }, [active]);
  return (
    <section
      className={`todo-detail-field todo-field-${name}`}
      data-editing={active}
    >
      {active ? (
        <form
          className="workspace-form todo-field-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (!busy) onCancel();
            }
          }}
        >
          {name === "domains" || name === "links" ? (
            <span className="todo-field-label">{label}</span>
          ) : (
            <label htmlFor={`todo-edit-${name}`}>{label}</label>
          )}
          <fieldset disabled={busy}>{children}</fieldset>
          <div className="todo-field-edit-actions">
            <Button size="sm" disabled={busy}>
              {tr("保存")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onCancel}
            >
              {tr("取消")}
            </Button>
          </div>
        </form>
      ) : (
        <div
          className="todo-field-read"
          onDoubleClick={(e) => {
            if (writable && !(e.target as HTMLElement).closest("a,button"))
              onEdit();
          }}
        >
          <div className="todo-field-content">
            {name !== "title" && (
              <span className="todo-field-label">{label}</span>
            )}
            <div className="todo-field-value">{view}</div>
          </div>
          {writable && (
            <button
              ref={pencil}
              type="button"
              className="todo-field-pencil"
              onClick={onEdit}
              aria-label={tr("编辑{field}", { field: label })}
              title={tr("双击或点击铅笔编辑")}
            >
              <Pencil size={15} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function TodoDetailFields({
  task,
  meta,
  writable,
  busy,
  onSave,
  onEditingChange,
}: {
  task: Todo;
  meta: Meta;
  writable: boolean;
  busy: boolean;
  onSave: (patch: Partial<Todo>) => Promise<boolean>;
  onEditingChange: (editing: boolean) => void;
}) {
  const { t: tr, date } = useI18n();
  const [active, setActive] = useState<Field | null>(null);
  const [values, setValues] = useState(task);
  useEffect(() => {
    setActive(null);
    setValues(task);
  }, [task.id, task.revision]);
  useEffect(() => {
    onEditingChange(!!active);
    return () => onEditingChange(false);
  }, [active, onEditingChange]);
  const priorities: Record<string, string> = {
    none: tr("无优先级"),
    low: tr("低"),
    medium: tr("中"),
    high: tr("高"),
  };
  const member =
    meta.members.find((m) => m.id === task.assignee_id)?.name ||
    tr(task.assignee_id ? "已离开成员" : "未分配");
  const project =
    meta.projects.find((p) => p.id === task.project_id)?.name ||
    task.project_id ||
    tr("未归属");
  const set = <K extends Field>(key: K, value: Todo[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const field = (
    name: Field,
    label: string,
    view: ReactNode,
    editor: ReactNode,
  ) => (
    <DetailField
      name={name}
      label={label}
      view={view}
      active={active === name}
      writable={writable && !busy && (!active || active === name)}
      busy={busy}
      onEdit={() => {
        if (!active && !busy) {
          setValues(structuredClone(task));
          setActive(name);
        }
      }}
      onCancel={() => {
        setValues(task);
        setActive(null);
      }}
      onSave={async () => {
        if (await onSave({ [name]: values[name] })) setActive(null);
      }}
    >
      {editor}
    </DetailField>
  );
  return (
    <div className="todo-detail-fields">
      {field(
        "title",
        tr("标题"),
        <h2 className="todo-detail-title">{task.title}</h2>,
        <input
          id="todo-edit-title"
          autoFocus
          required
          maxLength={500}
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
        />,
      )}
      <div className="todo-detail-properties">
        {field(
          "assignee_id",
          tr("负责人"),
          member,
          <select
            id="todo-edit-assignee_id"
            autoFocus
            value={values.assignee_id}
            onChange={(e) => set("assignee_id", e.target.value)}
          >
            <option value="">{tr("未分配")}</option>
            {values.assignee_id &&
              !meta.members.some((m) => m.id === values.assignee_id) && (
                <option value={values.assignee_id}>{tr("已离开成员")}</option>
              )}
            {meta.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>,
        )}
        {field(
          "priority",
          tr("优先级"),
          priorities[task.priority] || priorities.none,
          <select
            id="todo-edit-priority"
            autoFocus
            value={values.priority}
            onChange={(e) => set("priority", e.target.value)}
          >
            {Object.entries(priorities).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>,
        )}
        {field(
          "project_id",
          tr("项目"),
          project,
          <select
            id="todo-edit-project_id"
            autoFocus
            value={values.project_id}
            onChange={(e) => set("project_id", e.target.value)}
          >
            <option value="">{tr("未归属")}</option>
            {meta.projects
              .filter(
                (p) => p.status !== "archived" || p.id === values.project_id,
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>,
        )}
        {field(
          "due_date",
          tr("截止日期"),
          task.due_date ? (
            <time dateTime={task.due_date}>
              {date(`${task.due_date}T12:00:00Z`, {
                timeZone: "UTC",
                dateStyle: "medium",
              })}
            </time>
          ) : (
            <span className="muted">—</span>
          ),
          <input
            id="todo-edit-due_date"
            autoFocus
            type="date"
            value={values.due_date}
            onChange={(e) => set("due_date", e.target.value)}
          />,
        )}
      </div>
      {field(
        "domains",
        tr("领域"),
        task.domains.length ? (
          <div className="todo-detail-tags">
            {task.domains.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        ) : (
          <span className="muted">—</span>
        ),
        <div
          id="todo-edit-domains"
          className="todo-domains"
          role="group"
          aria-label={tr("领域")}
        >
          {Array.from(new Set([...meta.domains, ...values.domains])).map(
            (domain, index) => (
              <label key={domain}>
                <input
                  autoFocus={index === 0}
                  type="checkbox"
                  checked={values.domains.includes(domain)}
                  onChange={(e) =>
                    set(
                      "domains",
                      e.target.checked
                        ? [...values.domains, domain]
                        : values.domains.filter((d) => d !== domain),
                    )
                  }
                />
                {domain}
              </label>
            ),
          )}
        </div>,
      )}
      {field(
        "body",
        tr("描述"),
        task.body ? (
          <div className="todo-detail-markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: (props) => (
                  <a {...props} target="_blank" rel="noopener noreferrer" />
                ),
              }}
            >
              {task.body}
            </ReactMarkdown>
          </div>
        ) : (
          <span className="muted">{tr("暂无描述")}</span>
        ),
        <textarea
          id="todo-edit-body"
          autoFocus
          rows={5}
          maxLength={50000}
          value={values.body}
          onChange={(e) => set("body", e.target.value)}
        />,
      )}
      {field(
        "links",
        tr("交付链接"),
        task.links.length ? (
          <div className="todo-detail-links">
            {task.links.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={14} />
                <span>{link.title || link.url}</span>
              </a>
            ))}
          </div>
        ) : (
          <span className="muted">{tr("暂无交付链接")}</span>
        ),
        <div id="todo-edit-links">
          {values.links.map((link, index) => (
            <div className="todo-link-edit" key={index}>
              <input
                autoFocus={index === 0}
                aria-label={tr("链接名称")}
                placeholder={tr("链接名称")}
                value={link.title}
                onChange={(e) =>
                  set(
                    "links",
                    values.links.map((l, i) =>
                      i === index ? { ...l, title: e.target.value } : l,
                    ),
                  )
                }
              />
              <input
                type="url"
                required
                aria-label={tr("链接地址")}
                placeholder="https://"
                value={link.url}
                onChange={(e) =>
                  set(
                    "links",
                    values.links.map((l, i) =>
                      i === index ? { ...l, url: e.target.value } : l,
                    ),
                  )
                }
              />
              <button
                type="button"
                aria-label={tr("移除")}
                onClick={() =>
                  set(
                    "links",
                    values.links.filter((_, i) => i !== index),
                  )
                }
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            autoFocus={!values.links.length}
            disabled={values.links.length >= 20}
            onClick={() =>
              set("links", [...values.links, { title: "", url: "" }])
            }
          >
            <Plus size={14} />
            {tr("添加链接")}
          </Button>
        </div>,
      )}
    </div>
  );
}
