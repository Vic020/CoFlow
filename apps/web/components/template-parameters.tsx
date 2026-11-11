"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { request, type Meta } from "@/lib/types";
import { type AITemplate, templateParameterLabel } from "@/lib/assistant";
import { useI18n } from "./i18n-provider";
import { SelectMenu } from "./ui/select-menu";

export function TemplateParameters({
  template,
  values,
  onChange,
}: {
  template: AITemplate;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const { t } = useI18n(),
    search = useSearchParams();
  const [meta, setMeta] = useState<Meta | null>(null),
    [error, setError] = useState("");
  const live = useRef({ values, onChange });
  live.current = { values, onChange };
  const project = search.get("project") || "",
    domain = search.get("domain") || "",
    member = search.get("member") || "";
  useEffect(() => {
    let active = true;
    request<Meta>("/meta")
      .then((m) => {
        if (active) setMeta(m);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const projects = (meta?.projects || []).filter(
    (p) =>
      p.status !== "archived" &&
      !meta?.catalog?.some(
        (c) => c.id === p.id && ["archived", "merged"].includes(c.state),
      ),
  );
  function options(name: string) {
    if (name === "project" || name === "project_id")
      return projects.map((p) => ({ value: p.id, label: p.name }));
    if (name === "domain")
      return (meta?.domains || []).map((d) => ({ value: d, label: d }));
    if (["member", "member_id", "assignee", "assignee_id"].includes(name))
      return (meta?.members || []).map((m) => ({ value: m.id, label: m.name }));
    return null;
  }
  useEffect(() => {
    if (!meta) return;
    const next = { ...live.current.values };
    let changed = false;
    for (const p of template.parameters) {
      if (Object.prototype.hasOwnProperty.call(next, p.name)) continue;
      const candidates = options(p.name);
      if (!candidates) continue;
      const value = p.name.startsWith("project")
        ? project
        : p.name === "domain"
          ? domain
          : member;
      const match = candidates.find(
        (c) =>
          c.value === value || c.label.toLowerCase() === value.toLowerCase(),
      );
      if (match) {
        next[p.name] = match.value;
        changed = true;
      }
    }
    if (changed) {
      live.current.values = next;
      live.current.onChange(next);
    }
  }, [meta, template.id, template.version, project, domain, member]);
  function change(name: string, value: string) {
    const next = { ...live.current.values, [name]: value };
    live.current.values = next;
    live.current.onChange(next);
  }
  return (
    <>
      {error && (
        <p className="error-text" role="alert">
          {t(error)}
        </p>
      )}
      {template.parameters.map((p) => {
        const choices = options(p.name),
          label = templateParameterLabel(template, p, t);
        return (
          <label key={p.name}>
            {label}
            {p.required ? " *" : ""}
            {choices ? (
              <SelectMenu
                label={label}
                value={values[p.name] || ""}
                disabled={!meta}
                options={[{ value: "", label: t("请选择") }, ...choices]}
                onChange={(v) => change(p.name, v)}
              />
            ) : (
              <input
                required={p.required}
                value={values[p.name] || ""}
                maxLength={1000}
                onChange={(e) => change(p.name, e.target.value)}
              />
            )}
          </label>
        );
      })}
    </>
  );
}
