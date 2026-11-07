"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "./auth-gate";
import { useI18n } from "./i18n-provider";
import { request, setReadCacheScope } from "@/lib/types";
import { consumeAssistantStream } from "@/lib/assistant-stream";
import { publicDemo } from "@/lib/runtime";
import {
  defaultAIConfig,
  defaultWebConfig,
  type WebConfig,
  type AIConfig,
  type AITurn,
  type AIAction,
  type AIConversation,
  type AITemplate,
} from "@/lib/assistant";
import { PersonalAISettings } from "./personal-ai-settings";
import { PersonalProfile } from "./personal-profile";
import { AssistantManager } from "./assistant-manager";

type State = {
  streamed: string;
  streaming: boolean;
  webEnabled: boolean;
  webConfigs: WebConfig[];
  webReady: boolean;
  webError: string;
  webConfigured: boolean;
  webConfigID: string;
  setWebConfig: (id: string) => void;
  refreshWeb: () => Promise<void>;
  openWebSettings: (scope: "personal" | "team") => void;
  setWebEnabled: (value: boolean) => void;
  setStreaming: (v: boolean) => void;
  input: string;
  setInput: (s: string) => void;
  current: AIConversation | null;
  template: AITemplate | null;
  parameters: Record<string, string>;
  setTemplate: (t: AITemplate | null, p?: Record<string, string>) => void;
  mcpIDs: string[];
  setMCPIDs: (ids: string[]) => void;
  manager: "history" | "templates" | "jobs" | "mcp" | null;
  setManager: (s: State["manager"]) => void;
  configs: AIConfig[];
  configured: boolean;
  ready: boolean;
  error: string;
  configID: string;
  setConfig: (id: string) => void;
  turns: AITurn[];
  busy: boolean;
  pending: string;
  panel: boolean;
  setPanel: (open: boolean) => void;
  openPersonalSettings: (tab?: "profile" | "ai" | "web") => void;
  openSettings: (scope: "team" | "personal" | null) => void;
  send: (message: string) => Promise<void>;
  cancel: () => void;
  refresh: () => Promise<void>;
  saveDraft: (action: AIAction, title: string, body: string) => Promise<void>;
  act: (action: AIAction, decision: "confirm" | "cancel") => Promise<void>;
  conversations: AIConversation[];
  openConversation: (id: string) => Promise<void>;
  newConversation: () => void;
};
const Context = createContext<State | null>(null);
export function useAssistant() {
  const v = useContext(Context);
  if (!v) throw new Error("AssistantProvider missing");
  return v;
}
export function AssistantProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  return (
    <AssistantScope
      key={`${auth.mode}:${auth.me?.user.id}:${auth.me?.current_team}`}
    >
      {children}
    </AssistantScope>
  );
}
function AssistantScope({ children }: { children: ReactNode }) {
  const { locale, timeZone } = useI18n();
  const router = useRouter();
  const [personalSettings, openPersonalSettings] = useState<
    "profile" | "ai" | "web" | null
  >(null);
  function openSettings(scope: "team" | "personal" | null) {
    if (scope === "team") router.push("/settings/?tab=ai");
    else openPersonalSettings(scope === "personal" ? "ai" : null);
  }
  const pathname = usePathname();
  const params = useSearchParams();
  const [configs, setConfigs] = useState<AIConfig[]>([]),
    [configured, setConfigured] = useState(true),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [configID, updateConfig] = useState(""),
    [turns, setTurns] = useState<AITurn[]>([]),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(""),
    [panel, setPanel] = useState(false),
    [conversations, setConversations] = useState<AIConversation[]>([]);
  const [input, setInput] = useState("");
  const [streamed, setStreamed] = useState(""),
    [streaming, setStreaming] = useState(true);
  const [webEnabled, setWebEnabled] = useState(false);
  const [webConfigs, setWebConfigs] = useState<WebConfig[]>([]),
    [webConfigID, updateWebConfig] = useState(""),
    [webReady, setWebReady] = useState(false),
    [webConfigured, setWebConfigured] = useState(true),
    [webError, setWebError] = useState("");
  const selectedWeb = useRef("");
  function setWebConfig(value: string) {
    selectedWeb.current = value;
    updateWebConfig(value);
    setWebEnabled(false);
    retry.current = null;
  }
  function openWebSettings(scope: "personal" | "team") {
    if (scope === "team") router.push("/settings/?tab=web");
    else openPersonalSettings("web");
  }

  useEffect(() => setWebEnabled(false), [configID]);
  const drafts = useRef<Record<string, string>>({});
  const [current, setCurrent] = useState<AIConversation | null>(null);
  const [template, updateTemplate] = useState<AITemplate | null>(null),
    [parameters, setParameters] = useState<Record<string, string>>({}),
    [mcpIDs, setMCPIDs] = useState<string[]>([]),
    [manager, setManager] = useState<State["manager"]>(null);
  function setTemplate(t: AITemplate | null, p: Record<string, string> = {}) {
    if (pathname.replace(/\/$/, "") !== "/assistant") setPanel(true);
    newConversation();
    updateTemplate(t);
    setParameters(p);
  }
  const id = useRef("");
  const selected = useRef("");
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const sending = useRef(false);
  const acting = useRef(false);
  const retry = useRef<{
    web_enabled?: boolean;
    web_config_id?: string;
    message: string;
    request_id: string;
    config_id: string;
    conversation_id: string;
    locale?: string;
    context?: Record<string, string>;
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const refresh = useCallback(async () => {
    try {
      const v = await request<{
        items: AIConfig[];
        configured: boolean;
        selected_config_id?: string;
      }>("/assistant/configs");
      if (!alive.current) return;
      setConfigs(v.items);
      setConfigured(v.configured);
      if (!selected.current) {
        const next = v.selected_config_id || defaultAIConfig(v.items)?.id || "";
        selected.current = next;
        updateConfig(next);
      }
      setReady(true);
      setError("");
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        setReady(true);
      }
    }
  }, []);
  const refreshWeb = useCallback(async () => {
    try {
      const v = await request<{ items: WebConfig[]; configured: boolean }>(
        "/assistant/web-configs",
      );
      if (!alive.current) return;
      setWebConfigs(v.items);
      setWebConfigured(v.configured);
      setWebError("");
      if (!selectedWeb.current) {
        const next = defaultWebConfig(v.items)?.id || "";
        selectedWeb.current = next;
        updateWebConfig(next);
      }
    } catch (e) {
      if (alive.current) setWebError((e as Error).message);
    } finally {
      if (alive.current) setWebReady(true);
    }
  }, []);
  useEffect(() => {
    if (pathname.replace(/\/$/, "") === "/assistant") setPanel(false);
  }, [pathname]);
  useEffect(() => {
    if (pathname.replace(/\/$/, "") === "/assistant" || panel || manager) {
      void refresh();
      void refreshWeb();
    }
  }, [pathname, panel, manager, refresh, refreshWeb]);
  function newConversation() {
    if (sending.current) return;
    setWebEnabled(false);
    drafts.current[id.current] = input;
    setInput(drafts.current[""] || "");
    setCurrent(null);
    updateTemplate(null);
    setParameters({});
    id.current = "";
    setTurns([]);
    setPending("");
    retry.current = null;
    setError("");
  }
  function setConfig(next: string) {
    if (sending.current) return;
    selected.current = next;
    updateConfig(next);
    newConversation();
    void request("/assistant/preference", {
      method: "PATCH",
      body: JSON.stringify({ config_id: next }),
    }).catch((e) => setError((e as Error).message));
  }
  async function loadConversations() {
    const v = await request<{ items: AIConversation[] }>(
      "/assistant/conversations",
    );
    if (alive.current) setConversations(v.items);
  }
  useEffect(() => {
    if (ready && (panel || pathname.replace(/\/$/, "") === "/assistant"))
      void loadConversations().catch(() => {});
  }, [ready, panel, pathname]);
  async function openConversation(next: string) {
    if (sending.current) return;
    setError("");
    try {
      const c = await request<AIConversation>(
        `/assistant/conversations/${encodeURIComponent(next)}`,
      );
      if (!alive.current) return;
      drafts.current[id.current] = input;
      setInput(drafts.current[c.id] || "");
      setCurrent(c);
      setWebEnabled(false);
      updateTemplate(c.template || null);
      if (pathname.replace(/\/$/, "") !== "/assistant") setPanel(true);
      id.current = c.id;
      selected.current = c.config_id;
      updateConfig(c.config_id);
      setTurns(c.turns || []);
      retry.current = null;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send(message: string) {
    if (sending.current || !message.trim()) return;
    const chosen = configs.find((c) => c.id === selected.current);
    if (!chosen?.verified_at) {
      openSettings("personal");
      return;
    }
    sending.current = true;
    setBusy(true);
    setStreamed("");
    setPending(message);
    setError("");
    controller.current = new AbortController();
    const prior = retry.current;
    const current =
      prior &&
      prior.message === message &&
      prior.web_enabled === (webEnabled && !publicDemo) &&
      prior.web_config_id === (webEnabled ? selectedWeb.current : "") &&
      prior.config_id === selected.current &&
      prior.conversation_id === id.current
        ? prior
        : {
            message,
            request_id: crypto.randomUUID(),
            config_id: selected.current,
            conversation_id: id.current,
            locale,
            template_id: template?.id,
            template_version: template?.version,
            parameters,
            mcp_ids: mcpIDs,
            web_enabled: webEnabled && !publicDemo,
            web_config_id: webEnabled ? selectedWeb.current : "",
            context: {
              page: pathname,
              project: params.get("project") || "",
              domain: params.get("domain") || "",
              member: params.get("member") || "",
              todo: params.get("todo") || "",
              report: params.get("report") || "",
              date: params.get("date") || "",
              timezone: timeZone,
            },
          };
    retry.current = current;
    let success = false;
    try {
      let v: { conversation_id: string; turn: AITurn };
      if (streaming && !publicDemo) {
        const response = await fetch("/api/v1/assistant/chat", {
          method: "POST",
          signal: controller.current.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(current),
        });
        if (!response.ok) {
          if (response.status === 401) {
            setReadCacheScope(null);
            window.dispatchEvent(new Event("coflow:unauthorized"));
          }
          const e = await response
            .json()
            .catch(() => ({ error: "连接失败，请稍后重试" }));
          throw Error(e.error);
        }
        if (!response.body) throw Error("模型流已中断，请重试同一请求");
        v = await consumeAssistantStream(response.body, (text) => {
          if (alive.current) setStreamed((s) => s + text);
        });
      } else {
        v = await request<{ conversation_id: string; turn: AITurn }>(
          "/assistant/chat",
          {
            method: "POST",
            signal: controller.current.signal,
            body: JSON.stringify(current),
          },
        );
      }
      if (!alive.current) return;
      id.current = v.conversation_id;
      void request<AIConversation>(
        `/assistant/conversations/${encodeURIComponent(v.conversation_id)}`,
      )
        .then((c) => {
          if (alive.current && id.current === c.id) setCurrent(c);
        })
        .catch(() => {});
      setTurns((xs) =>
        xs.some((t) => t.request_id === v.turn.request_id)
          ? xs
          : [...xs, v.turn],
      );
      retry.current = null;
      success = true;
      void loadConversations().catch(() => {});
    } catch (e) {
      if (alive.current)
        setError(
          (e as Error).name === "AbortError"
            ? "已停止生成；业务操作仍需确认"
            : (e as Error).message,
        );
    } finally {
      sending.current = false;
      if (alive.current) {
        setBusy(false);
        if (success) setPending("");
      }
    }
  }
  function cancel() {
    controller.current?.abort();
  }
  async function saveDraft(action: AIAction, title: string, body: string) {
    const v = await request<AIAction>(`/assistant/actions/${action.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title, body }),
    });
    if (alive.current)
      setTurns((xs) =>
        xs.map((t) => ({
          ...t,
          actions: t.actions.map((a) => (a.id === v.id ? v : a)),
        })),
      );
  }
  async function act(action: AIAction, decision: "confirm" | "cancel") {
    if (acting.current) return;
    acting.current = true;
    setError("");
    try {
      const v = await request<AIAction>(`/assistant/actions/${action.id}`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      if (!alive.current) return;
      setTurns((xs) =>
        xs.map((t) => ({
          ...t,
          actions: t.actions.map((a) => (a.id === v.id ? v : a)),
        })),
      );
      if (v.state === "done")
        window.dispatchEvent(new Event("coflow:assistant-change"));
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      acting.current = false;
    }
  }
  const value: State = {
    streamed,
    streaming,
    setStreaming,
    webEnabled,
    webConfigs,
    webReady,
    webConfigured,
    webError,
    webConfigID,
    setWebConfig,
    refreshWeb,
    openWebSettings,
    setWebEnabled,
    input,
    setInput,
    current,
    template,
    parameters,
    setTemplate,
    mcpIDs,
    setMCPIDs,
    manager,
    setManager,
    configs,
    configured,
    ready,
    error,
    configID,
    setConfig,
    turns,
    busy,
    pending,
    panel,
    setPanel,
    openSettings,
    openPersonalSettings: (tab = "profile") => openPersonalSettings(tab),
    send,
    cancel,
    refresh,
    act,
    saveDraft,
    conversations,
    openConversation,
    newConversation,
  };
  return (
    <Context.Provider value={value}>
      {children}
      {personalSettings === "profile" && (
        <PersonalProfile onClose={() => openPersonalSettings(null)} />
      )}
      {(personalSettings === "ai" || personalSettings === "web") && (
        <PersonalAISettings
          key={personalSettings}
          initialTab={personalSettings}
          onClose={() => openPersonalSettings(null)}
        />
      )}

      {manager && (
        <AssistantManager page={manager} onClose={() => setManager(null)} />
      )}
    </Context.Provider>
  );
}
