"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { useAuth } from "./auth-gate";
import { useI18n } from "./i18n-provider";
import { SelectMenu } from "./ui/select-menu";
import {
  emptySharedFilters,
  readSharedFilters,
  sharedFilterPage,
  sharedFilterURL,
  storedSharedFilters,
  sharedFilterKeys,
  restoreSharedFilters,
  type SharedFilters,
} from "@/lib/shared-filters";
import { calendarPresentation } from "@/lib/calendar";
import type { Meta } from "@/lib/types";

type FilterContext = {
  filters: SharedFilters;
  update: (patch: Partial<SharedFilters>) => void;
  href: (path: string) => string;
  reporter: boolean;
};
const Context = createContext<FilterContext | null>(null);
export function useSharedFilters() {
  const value = useContext(Context);
  if (!value) throw new Error("Shared filter provider missing");
  return value;
}

export function SharedFilterProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { t: tr } = useI18n();
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const query = search.toString();
  const identity =
    auth.mode === "local-demo"
      ? "local-demo"
      : `${auth.me?.user.id}:${auth.me?.current_team}`;
  const storageKey = `coflow:shared-filters:${identity}`;
  const [filters, setFilters] = useState<SharedFilters>(emptySharedFilters);
  const [ready, setReady] = useState(false);
  const state = useRef({
    identity: "",
    filters: { ...emptySharedFilters },
    url: "",
  });
  useEffect(() => {
    const currentURL = `${path}${query ? `?${query}` : ""}`;
    const page = sharedFilterPage(path);
    if (state.current.identity !== identity) {
      let stored = { ...emptySharedFilters };
      let previous: string | null = null;
      try {
        stored = storedSharedFilters(sessionStorage.getItem(storageKey));
        previous = sessionStorage.getItem("coflow:filter-identity");
      } catch {}
      const incoming = page
        ? readSharedFilters(new URLSearchParams(query))
        : null;
      state.current = {
        identity,
        filters: restoreSharedFilters(identity, previous, stored, incoming),
        url: "",
      };
      setFilters(state.current.filters);
      setReady(true);
    } else if (state.current.url !== currentURL && page) {
      const incoming = readSharedFilters(new URLSearchParams(query));
      if (
        incoming &&
        sharedFilterKeys.some(
          (key) => incoming[key] !== state.current.filters[key],
        )
      ) {
        state.current.filters = incoming;
        setFilters(incoming);
      }
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state.current.filters));
      sessionStorage.setItem("coflow:filter-identity", identity);
    } catch {}
    const next = page
      ? sharedFilterURL(currentURL, state.current.filters)
      : currentURL;
    state.current.url = next;
    if (next !== currentURL) router.replace(next, { scroll: false });
  }, [identity, storageKey, path, query, router]);
  const update = useCallback(
    (patch: Partial<SharedFilters>) => {
      const next = { ...state.current.filters, ...patch };
      state.current.filters = next;
      setFilters(next);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
      const url = sharedFilterURL(`${path}${query ? `?${query}` : ""}`, next);
      state.current.url = url;
      router.replace(url, { scroll: false });
    },
    [path, query, storageKey, router],
  );
  const value = useMemo(
    () => ({
      filters,
      update,
      href: (href: string) => sharedFilterURL(href, state.current.filters),
      reporter:
        path.replace(/\/$/, "") !== "/todo" &&
        (path.replace(/\/$/, "") !== "/calendar" ||
          calendarPresentation(search).source === "reports"),
    }),
    [filters, update, path, query],
  );
  if (!ready || state.current.identity !== identity)
    return (
      <p role="status" className="workspace-loading">
        {tr("加载中…")}
      </p>
    );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function GlobalFilters({ meta }: { meta: Meta }) {
  const { filters, update, reporter } = useSharedFilters();
  const { t: tr } = useI18n();
  const active = Object.values(filters).some(Boolean);
  const role = tr(reporter ? "上报人" : "负责人");
  const projects = meta.projects.map((p) => ({ value: p.id, label: p.name }));
  const domains = meta.domains.map((d) => ({ value: d, label: d }));
  const members = meta.members.map((m) => ({
    value: m.id,
    label: `${role} · ${m.name}`,
  }));
  if (filters.project && !projects.some((p) => p.value === filters.project))
    projects.push({ value: filters.project, label: tr("项目不可用") });
  if (filters.domain && !domains.some((d) => d.value === filters.domain))
    domains.push({ value: filters.domain, label: filters.domain });
  if (filters.member && !members.some((m) => m.value === filters.member))
    members.push({ value: filters.member, label: tr("已离开成员") });
  return (
    <section className="workspace-global-filters" aria-label={tr("全局筛选")}>
      <span className="global-filter-label">{tr("工作范围")}</span>
      <SelectMenu
        label={tr("全局项目")}
        value={filters.project}
        onChange={(project) => update({ project })}
        options={[{ value: "", label: tr("全部项目") }, ...projects]}
      />
      <SelectMenu
        label={tr("全局领域")}
        value={filters.domain}
        onChange={(domain) => update({ domain })}
        options={[{ value: "", label: tr("全部领域") }, ...domains]}
      />
      <SelectMenu
        label={`${tr("全局成员")} · ${role}`}
        value={filters.member}
        onChange={(member) => update({ member })}
        options={[
          { value: "", label: tr(reporter ? "全部上报人" : "全部负责人") },
          ...members,
        ]}
      />
      {active && (
        <button
          type="button"
          className="global-filter-reset"
          aria-label={tr("重置全局筛选")}
          title={tr("重置全局筛选")}
          onClick={() => update({ ...emptySharedFilters })}
        >
          <X size={14} />
          <span>{tr("重置")}</span>
        </button>
      )}
    </section>
  );
}
