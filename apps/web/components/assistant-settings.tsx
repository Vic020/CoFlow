"use client";
import { useEffect, useState } from "react";
import { Check, Plus, Trash2, Loader2, Pencil, X } from "lucide-react";
import { useAssistant } from "./assistant-provider";
import { useI18n } from "./i18n-provider";
import { useAuth } from "./auth-gate";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { request } from "@/lib/types";
import { aiProviders, type AIConfig } from "@/lib/assistant";
import { publicDemo } from "@/lib/runtime";

export function AISettings({ scope }: { scope: "team" | "personal" }) {
  const ai = useAssistant(),
    auth = useAuth(),
    { t: tr } = useI18n();
  const [editing, setEditing] = useState<AIConfig | "new" | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [remove, setRemove] = useState<AIConfig | null>(null);
  const editable = scope === "personal" || auth.me?.role === "admin";
  const configs = ai.configs.filter((c) => c.scope === scope);
  useEffect(() => {
    void ai.refresh();
  }, [ai.refresh]);
  async function verify(c: AIConfig) {
    setBusy(c.id);
    setError("");
    try {
      await request(`/assistant/configs/${c.id}/verify`, { method: "POST" });
      await ai.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="ai-settings">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          ai.openSettings(null);
          ai.setManager("templates");
        }}
      >
        {tr("任务模板")}
      </Button>
      {publicDemo ? (
        <p className="muted">
          {tr("演示使用合成对话，不保存 API Key 或访问模型服务。")}
        </p>
      ) : !ai.configured ? (
        <p className="error-text">
          {tr("请先在服务器配置 COFLOW_AI_ENCRYPTION_KEY")}
        </p>
      ) : (
        <>
          {editing ? (
            <ConfigForm
              scope={scope}
              config={editing === "new" ? undefined : editing}
              onDone={() => {
                setEditing(null);
                void ai.refresh();
              }}
            />
          ) : (
            <>
              <div className="ai-config-list">
                {configs.length === 0 && (
                  <p className="muted">
                    {tr(scope === "team" ? "尚无团队共用配置" : "尚无个人配置")}
                  </p>
                )}
                {configs.map((c) => (
                  <div className="ai-config-row" key={c.id}>
                    <div>
                      <strong>{c.name}</strong>
                      <small>
                        {c.model} · {tr(c.verified_at ? "已验证" : "待验证")}
                        {c.is_default ? ` · ${tr("默认")}` : ""}
                      </small>
                    </div>
                    {c.editable && (
                      <div className="ai-row-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => void verify(c)}
                        >
                          {busy === c.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Check size={14} />
                          )}{" "}
                          {tr("验证")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={tr("编辑配置")}
                          onClick={() => setEditing(c)}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={tr("删除配置")}
                          onClick={() => setRemove(c)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {editable && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing("new")}
                >
                  <Plus size={14} />
                  {tr("添加配置")}
                </Button>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error-text">
          {tr(error)}
        </p>
      )}
      {remove && (
        <Dialog open onOpenChange={(v) => !v && setRemove(null)}>
          <DialogContent className="ai-confirm-dialog">
            <DialogTitle>{tr("删除 AI 配置？")}</DialogTitle>
            <DialogDescription>
              {tr("删除后无法继续使用此配置；已有业务记录保留。")}
            </DialogDescription>
            <p>{remove.name}</p>
            <div className="ai-form-actions">
              <Button variant="outline" onClick={() => setRemove(null)}>
                {tr("取消")}
              </Button>
              <Button
                disabled={!!busy}
                onClick={async () => {
                  setBusy(remove.id);
                  try {
                    await request(`/assistant/configs/${remove.id}`, {
                      method: "DELETE",
                      body: JSON.stringify({
                        expected_revision: remove.revision,
                      }),
                    });
                    setRemove(null);
                    await ai.refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                {tr("删除")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
function ConfigForm({
  scope,
  config,
  onDone,
}: {
  scope: "team" | "personal";
  config?: AIConfig;
  onDone: () => void;
}) {
  const { t: tr } = useI18n();
  const [provider, setProvider] = useState(config?.provider || "deepseek"),
    [protocol, setProtocol] = useState(config?.protocol || "chat-completions"),
    [base, setBase] = useState(config?.base_url || aiProviders[0].base),
    [model, setModel] = useState(config?.model || ""),
    [name, setName] = useState(config?.name || ""),
    [key, setKey] = useState(""),
    [defaultValue, setDefault] = useState(config?.is_default ?? true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="ai-config-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await request(
            config ? `/assistant/configs/${config.id}` : "/assistant/configs",
            {
              method: config ? "PUT" : "POST",
              body: JSON.stringify({
                scope,
                name,
                provider,
                protocol,
                base_url: base,
                model,
                api_key: key,
                is_default: defaultValue,
                expected_revision: config?.revision,
              }),
            },
          );
          setKey("");
          onDone();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="ai-form-heading">
        <strong>{tr(config ? "编辑配置" : "添加配置")}</strong>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={tr("取消")}
          onClick={onDone}
        >
          <X size={15} />
        </Button>
      </div>
      <div className="ai-form-grid">
        <label>
          {tr("服务商")}
          <select
            value={provider}
            onChange={(e) => {
              const p = aiProviders.find((p) => p.id === e.target.value)!;
              setProvider(p.id);
              setProtocol(p.protocol);
              setBase(p.base);
            }}
          >
            {aiProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {tr(p.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {tr("名称")}
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      {provider === "compatible" && (
        <label>
          {tr("协议")}
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
          >
            <option value="chat-completions">Chat Completions</option>
            <option value="responses">Responses</option>
          </select>
        </label>
      )}
      <label>
        API Base URL
        <input
          type="url"
          required
          value={base}
          onChange={(e) => setBase(e.target.value)}
          autoComplete="off"
        />
      </label>
      <label>
        {tr("模型")}
        <input
          required
          maxLength={150}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={tr("填写账户可调用的模型 ID")}
          autoComplete="off"
        />
      </label>
      <label>
        API Key
        <input
          type="password"
          required={!config}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={config ? tr("留空保留现有密钥") : undefined}
          autoComplete="new-password"
        />
      </label>
      <label className="ai-checkbox">
        <input
          type="checkbox"
          checked={defaultValue}
          onChange={(e) => setDefault(e.target.checked)}
        />
        {tr("设为默认配置")}
      </label>
      {error && (
        <p role="alert" className="error-text">
          {tr(error)}
        </p>
      )}
      <div className="ai-form-actions">
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={busy}
        >
          {tr("取消")}
        </Button>
        <Button disabled={busy}>
          {busy && <Loader2 size={14} className="animate-spin" />}
          {tr("保存配置")}
        </Button>
      </div>
    </form>
  );
}
