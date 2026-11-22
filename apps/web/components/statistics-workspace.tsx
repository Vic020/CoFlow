"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { request, invalidateReadCache, type Meta } from "@/lib/types";
import { addDays, civilDay, validCivilDay } from "@/lib/calendar";
import { statisticLabels, type StatisticsResult } from "@/lib/statistics";
import { useSharedFilters } from "./shared-filters";
import { useI18n } from "./i18n-provider";
import { useAssistant } from "./assistant-provider";
import { Button } from "./ui/button";
import { SelectMenu } from "./ui/select-menu";
import { ContentSkeleton, LoadingStatus } from "./ui/loading-status";
import { SearchPicker, TimezonePicker } from "./timezone-picker";
import { publicDemo } from "@/lib/runtime";

export function StatisticsWorkspace({ meta }: { meta: Meta }) {
  const { t, date, timeZone, locale } = useI18n(),
    shared = useSharedFilters(),
    search = useSearchParams(),
    router = useRouter(),
    ai = useAssistant();
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);
  const today = civilDay(new Date(), timeZone);
  const from = search.get("from") || addDays(today, -6),
    to = search.get("to") || addDays(today, 1),
    zone = search.get("timezone") || timeZone,
    groupBy = search.get("group_by") || "project",
    metric = search.get("metric") || "",
    group = search.get("group");
  const [value, setValue] = useState<StatisticsResult | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const sequence = useRef(0);
  const [refresh, setRefresh] = useState(0);
  const [loadedView, setLoadedView] = useState({
    metric: "",
    groupBy: "project",
  });
  const params = new URLSearchParams({
    from,
    to,
    timezone: zone,
    group_by: groupBy,
    include_sources: "true",
    ...shared.filters,
  });
  if (metric) params.set("metric", metric);
  if (group !== null) params.set("group", group);
  for (const k of ["agent", "model", "offset", "revision"])
    if (search.get(k)) params.set(k, search.get(k)!);
  const query = params.toString();
  function update(patch: Record<string, string>) {
    const p = new URLSearchParams(search.toString());
    p.delete("offset");
    p.delete("revision");
    for (const [k, v] of Object.entries(patch)) {
      v ? p.set(k, v) : p.delete(k);
    }
    router.replace("/statistics?" + p, { scroll: false });
  }
  useEffect(() => {
    const n = ++sequence.current;
    let active = true;
    setBusy(true);
    setError("");
    request<StatisticsResult>("/statistics?" + query)
      .then((v) => {
        if (active && n === sequence.current) {
          setValue(v);
          setLoadedView({ metric, groupBy });
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [query, refresh]);
  const count = (key: string) =>
    value?.metrics.find((m) => m.key === key)?.count || 0;
  const name = (key: string) =>
    loadedView.groupBy === "project"
      ? meta.projects.find((p) => p.id === key)?.name || key
      : loadedView.groupBy === "member"
        ? meta.members.find((m) => m.id === key)?.name || key
        : key;
  const max = Math.max(
    1,
    ...(value?.trend || []).map(
      (d) => (d.values.reports_created || 0) + (d.values.todos_completed || 0),
    ),
  );
  return (
    <section className="statistics-workspace" aria-busy={busy}>
      <div className="statistics-toolbar">
        <div className="segmented">
          {[7, 30].map((days) => (
            <button
              key={days}
              className={
                from === addDays(today, 1 - days) && to === addDays(today, 1)
                  ? "active"
                  : ""
              }
              onClick={() =>
                update({
                  from: addDays(today, 1 - days),
                  to: addDays(today, 1),
                  metric: "",
                  group: "",
                })
              }
            >
              {t("最近 {days} 天", { days })}
            </button>
          ))}
        </div>
        <label>
          {t("开始日期")}
          <input
            aria-label={t("开始日期")}
            type="date"
            value={from}
            onChange={(e) => update({ from: e.target.value })}
          />
        </label>
        <label>
          {t("结束日期")}
          <input
            aria-label={t("结束日期")}
            type="date"
            value={validCivilDay(to) ? addDays(to, -1) : ""}
            onChange={(e) => {
              if (e.target.value) update({ to: addDays(e.target.value, 1) });
            }}
          />
        </label>
        <TimezonePicker
          value={zone}
          zones={["UTC", ...Intl.supportedValuesOf("timeZone")]}
          onSelect={(timezone) => update({ timezone })}
        />
        <SearchPicker
          className="statistics-source-picker"
          label="Agent"
          value={search.get("agent") || ""}
          options={value?.sources?.agents ?? []}
          allLabel={t("全部 Agent")}
          placeholder={t("搜索 Agent…")}
          emptyMessage={value?.sources?.agents?.length ? t("没有匹配的来源") : t("暂无来源记录")}
          disabled={!value}
          onSelect={(agent) => update({ agent, group: "" })}
        />
        <SearchPicker
          className="statistics-source-picker"
          label={t("模型")}
          value={search.get("model") || ""}
          options={value?.sources?.models ?? []}
          allLabel={t("全部模型")}
          placeholder={t("搜索模型…")}
          emptyMessage={value?.sources?.models?.length ? t("没有匹配的来源") : t("暂无来源记录")}
          disabled={!value}
          onSelect={(model) => update({ model, group: "" })}
        />
        <LoadingStatus active={busy && !!value} />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("刷新")}
          onClick={() => {
            invalidateReadCache();
            update({ revision: "" });
            setRefresh((x) => x + 1);
          }}
        >
          <RefreshCw size={14} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!value || busy || publicDemo}
          onClick={() => {
            ai.newConversation();
            void ai.send(
              t(
                "请读取当前范围的统计：{from} 至 {to}（结束日期不含），时区 {zone}，项目 {project}，领域 {domain}，成员 {member}，Agent {agent}，模型 {model}。调用 read_statistics，区分当前快照与期间事件，说明缺失历史并给出来源。",
                {
                  from,
                  to,
                  zone,
                  project: shared.filters.project || "all",
                  domain: shared.filters.domain || "all",
                  member: shared.filters.member || "all",
                  agent: search.get("agent") || "all",
                  model: search.get("model") || "all",
                },
              ),
            );
            ai.setPanel(true);
          }}
        >
          {t("AI 解读")}
        </Button>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {t(error)}
        </p>
      )}
      {!value ? (
        busy ? (
          <ContentSkeleton variant="workspace" />
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefresh((x) => x + 1)}
          >
            {t("重试")}
          </Button>
        )
      ) : (
        <>
          {publicDemo && (
            <p className="statistics-note">
              {t("离线统计仅使用合成演示数据，不连接真实空间。")}
            </p>
          )}
          <p className="statistics-note">
            {t("期间事件与当前状态分别统计；点击数字查看原始记录。")}{" "}
            {value.from} – {addDays(value.to, -1)} ({value.timezone}) ·{" "}
            {date(value.generated_at, { hour: "2-digit", minute: "2-digit" })}
          </p>
          <div className="statistics-metrics">
            {[
              "reports_created",
              "todos_completed",
              "todos_open",
              "todos_overdue",
            ]
              .filter((k) => value.metrics.some((m) => m.key === k))
              .map((key) => (
                <button
                  key={key}
                  className={metric === key ? "selected" : ""}
                  disabled={busy}
                  onClick={() => update({ metric: key, group: "" })}
                >
                  <span>{t(statisticLabels[key])}</span>
                  <strong>{number(count(key))}</strong>
                  <small>
                    {t(
                      key.includes("open") || key.includes("overdue")
                        ? "当前状态"
                        : "所选期间",
                    )}
                  </small>
                </button>
              ))}
          </div>
          <div className="statistics-panels">
            <section className="statistics-panel">
              <h2>{t("进展与完成趋势")}</h2>
              <div
                className="statistics-trend"
                role="img"
                aria-label={t("每天新增进展与完成任务数量")}
              >
                {value.trend.map((d) => (
                  <div
                    key={d.day}
                    className="statistics-day"
                    title={`${d.day} · ${t("新增进展")} ${d.values.reports_created || 0} · ${t("完成任务")} ${d.values.todos_completed || 0}`}
                  >
                    <div className="statistics-bars">
                      <span
                        style={{
                          height: `${(100 * (d.values.reports_created || 0)) / max}%`,
                        }}
                      />
                      <span
                        style={{
                          height: `${(100 * (d.values.todos_completed || 0)) / max}%`,
                        }}
                      />
                    </div>
                    <small>{d.day.slice(5)}</small>
                  </div>
                ))}
              </div>
              <p className="statistics-legend">
                <span>{t("新增进展")}</span>
                <span>{t("完成任务")}</span>
              </p>
            </section>
            <section className="statistics-panel">
              <h2>{t("完成用时")}</h2>
              {[
                ["under_day", "少于 1 天"],
                ["one_to_seven_days", "1–7 天"],
                ["over_seven_days", "超过 7 天"],
                ["missing", "缺少周期历史"],
              ].map(([k, label]) => (
                <div className="statistics-summary" key={k}>
                  <span>{t(label)}</span>
                  <strong>{number(value.duration[k] || 0)}</strong>
                </div>
              ))}
              <small>
                {t("按任务在期间内首次完成的未完成周期计算，不代表工时。")}
              </small>
            </section>
          </div>
          <section className="statistics-panel">
            <div className="statistics-section-heading">
              <h2>{t("分组明细")}</h2>
              <SelectMenu
                label={t("分组")}
                value={groupBy}
                onChange={(group_by) => update({ group_by, group: "" })}
                options={[
                  ["project", "项目"],
                  ["domain", "领域"],
                  ["member", "成员"],
                  ["agent", "Agent"],
                  ["model", "模型"],
                ].map(([value, label]) => ({ value, label: t(label) }))}
              />
            </div>
            <div className="statistics-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("分组")}</th>
                    {[
                      "reports_created",
                      "todos_completed",
                      "todos_open",
                      "calendar_nodes",
                    ]
                      .filter((k) => value.metrics.some((m) => m.key === k))
                      .map((k) => (
                        <th key={k}>{t(statisticLabels[k])}</th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {value.groups.map((g) => (
                    <tr key={g.key}>
                      <th>{name(g.key) || t("未指定")}</th>
                      {[
                        "reports_created",
                        "todos_completed",
                        "todos_open",
                        "calendar_nodes",
                      ]
                        .filter((k) => value.metrics.some((m) => m.key === k))
                        .map((k) => (
                          <td key={k}>
                            <button
                              onClick={() =>
                                update({
                                  metric: k,
                                  group: g.key || "__unassigned__",
                                })
                              }
                            >
                              {number(g.values[k] || 0)}
                            </button>
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="statistics-panel">
            <h2>{t("全部指标")}</h2>
            <div className="statistics-all-metrics">
              {value.metrics.map((m) => (
                <button
                  key={m.key}
                  disabled={busy}
                  onClick={() => update({ metric: m.key, group: "" })}
                >
                  <span>{t(statisticLabels[m.key])}</span>
                  <strong>{number(m.count)}</strong>
                  <small>
                    {t(
                      m.basis.startsWith("current")
                        ? "当前状态"
                        : m.basis.startsWith("overlapping")
                          ? "范围内计划"
                          : "所选期间",
                    )}
                  </small>
                </button>
              ))}
            </div>
          </section>
          {loadedView.metric && (
            <section className="statistics-panel statistics-details">
              <div className="statistics-section-heading">
                <h2>
                  {t(statisticLabels[loadedView.metric] || loadedView.metric)} ·{" "}
                  {number(value.detail_total)}
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => update({ metric: "", group: "" })}
                >
                  {t("收起")}
                </Button>
              </div>
              {value.details.map((r, i) => (
                <Link key={`${r.id}-${i}`} href={r.url}>
                  {r.title}
                  <span>
                    {date(r.at, { month: "short", day: "numeric" })} ↗
                  </span>
                </Link>
              ))}
              {!value.detail_total && <p>{t("没有匹配记录")}</p>}
              {Number(search.get("offset") || 0) > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    const p = new URLSearchParams(search.toString());
                    p.set(
                      "offset",
                      String(Math.max(0, Number(p.get("offset") || 0) - 50)),
                    );
                    p.set("revision", value.revision);
                    router.replace("/statistics?" + p, { scroll: false });
                  }}
                >
                  {t("上一页")}
                </Button>
              )}
              {value.has_more && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    const p = new URLSearchParams(search.toString());
                    p.set("offset", String(value.next_offset));
                    p.set("revision", value.revision);
                    router.replace("/statistics?" + p, { scroll: false });
                  }}
                >
                  {t("下一页")}
                </Button>
              )}
            </section>
          )}
          <details className="statistics-panel">
            <summary>{t("统计口径与覆盖范围")}</summary>
            <p>
              {t(
                "当前状态不等于历史交付日；多领域分组不可直接相加；活动量不代表质量或工时。",
              )}
            </p>
            <p>
              {t(
                "成员：进展按作者，当前任务与协作按负责人；任务完成与重开按当时快照，协作完成缺少归属快照时仅计团队总数。",
              )}
            </p>
            <p>
              {t(
                "缺少周期起点不推算用时。统计范围最多 93 天，原始记录分页展示；数据变化需重新刷新。",
              )}
            </p>
            <p>
              {t("Agent／模型筛选只统计有对应来源的记录，不将来源视为成员。")}
            </p>
            <p>
              {t(
                "简报期间指标按当前分类过滤。旧任务缺少创建快照时归属当前分类；协作完成缺少归属快照，只提供团队总数，不提供项目／领域／成员筛选结果。",
              )}
            </p>
          </details>
        </>
      )}
    </section>
  );
}
