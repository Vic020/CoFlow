"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Check, Loader2, X } from "lucide-react";
import { useAssistant } from "./assistant-provider";
import { useAuth } from "./auth-gate";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { ContentSkeleton } from "./ui/loading-status";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { request } from "@/lib/types";
import { publicDemo } from "@/lib/runtime";
import { webProviders, type WebConfig } from "@/lib/assistant";

export function WebSettings({ scope }: { scope: "personal" | "team" }) {
  const ai = useAssistant(),
    auth = useAuth(),
    { t } = useI18n();
  const [editing, setEditing] = useState<WebConfig | "new" | null>(null),
    [remove, setRemove] = useState<WebConfig | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void ai.refreshWeb();
  }, [ai.refreshWeb]);
  const configs = ai.webConfigs.filter((c) => c.scope === scope);
  const editable = scope === "personal" || auth.me?.role === "admin";
  return (
    <div className="ai-settings web-settings">
      <p className="muted">
        {t("独立于对话模型，搜索和抓取使用所选服务的密钥。")}
      </p>
      {publicDemo ? (
        <p className="muted">{t("演示不连接外部联网服务")}</p>
      ) : !ai.webReady ? (
        <ContentSkeleton />
      ) : ai.webError ? (
        <p role="alert" className="error-text">
          {t(ai.webError)}{" "}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void ai.refreshWeb()}
          >
            {t("重试")}
          </Button>
        </p>
      ) : !ai.webConfigured ? (
        <p role="alert" className="error-text">
          {t("请先在服务器配置 COFLOW_AI_ENCRYPTION_KEY")}
        </p>
      ) : editing ? (
        <WebForm
          scope={scope}
          config={editing === "new" ? undefined : editing}
          onDone={() => {
            setEditing(null);
            ai.setWebEnabled(false);
            void ai.refreshWeb();
          }}
        />
      ) : (
        <>
          <div className="ai-config-list">
            {configs.map((c) => (
              <div className="ai-config-row" key={c.id}>
                <div>
                  <strong>{c.name}</strong>
                  <small>
                    {webProviders.find((p) => p.id === c.provider)?.name} ·{" "}
                    {t(c.verified_at ? "已验证" : "待验证")}
                    {c.is_default ? ` · ${t("默认")}` : ""}
                  </small>
                </div>
                {c.editable && (
                  <div className="ai-row-actions">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("编辑配置")}
                      onClick={() => setEditing(c)}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("删除配置")}
                      onClick={() => setRemove(c)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {!configs.length && <p className="muted">{t("尚无联网配置")}</p>}
          {editable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing("new")}
            >
              <Plus size={14} />
              {t("添加联网配置")}
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error-text">
          {t(error)}
        </p>
      )}
      {remove && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v && !busy) setRemove(null);
          }}
        >
          <DialogContent className="ai-confirm-dialog">
            <DialogTitle>{t("删除联网配置？")}</DialogTitle>
            <DialogDescription>
              {t("已有来源记录保留，后续请求不能再使用此配置。")}
            </DialogDescription>
            <p>{remove.name}</p>
            <div className="ai-form-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setRemove(null)}
              >
                {t("取消")}
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await request(`/assistant/web-configs/${remove.id}`, {
                      method: "DELETE",
                      body: JSON.stringify({
                        expected_revision: remove.revision,
                      }),
                    });
                    setRemove(null);
                    ai.setWebEnabled(false);
                    await ai.refreshWeb();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {t("删除")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
function WebForm({
  scope,
  config,
  onDone,
}: {
  scope: "personal" | "team";
  config?: WebConfig;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(config?.name || ""),
    [provider, setProvider] = useState(config?.provider || "tavily"),
    [key, setKey] = useState(""),
    [defaultValue, setDefault] = useState(config?.is_default ?? true),
    [checking, setChecking] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const fingerprint = JSON.stringify([provider, key.trim()]);
  const latest = useRef(fingerprint);
  latest.current = fingerprint;
  const [proof, setProof] = useState<{
    fingerprint: string;
    token: string;
    expires: number;
  } | null>(() =>
    config?.verified_at ? { fingerprint, token: "", expires: Infinity } : null,
  );
  const mounted = useRef(true),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!proof || !Number.isFinite(proof.expires)) return;
    const timer = setTimeout(
      () => setProof(null),
      Math.max(0, proof.expires - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [proof]);
  const verified =
    proof?.fingerprint === fingerprint && proof.expires > Date.now();
  const body = () => ({
    id: config?.id,
    scope,
    name,
    provider,
    api_key: key,
    expected_revision: config?.revision,
    is_default: defaultValue,
  });
  return (
    <form
      className="ai-config-form"
      aria-busy={checking || saving}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!verified || checking || saving) return;
        setSaving(true);
        setError("");
        try {
          await request(
            config
              ? `/assistant/web-configs/${config.id}`
              : "/assistant/web-configs",
            {
              method: config ? "PUT" : "POST",
              body: JSON.stringify({
                ...body(),
                verification_token: proof?.token || undefined,
              }),
            },
          );
          setKey("");
          onDone();
        } catch (e) {
          if (mounted.current) {
            setProof(null);
            setError((e as Error).message);
          }
        } finally {
          if (mounted.current) setSaving(false);
        }
      }}
    >
      <div className="ai-form-heading">
        <strong>{t(config ? "编辑配置" : "添加联网配置")}</strong>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={t("取消")}
          disabled={saving}
          onClick={onDone}
        >
          <X size={15} />
        </Button>
      </div>
      <fieldset className="ai-config-fields" disabled={saving}>
        <div className="ai-form-grid">
          <label>
            {t("服务商")}
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setKey("");
              }}
            >
              {webProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("名称")}
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        <small className="muted">
          {webProviders.find((p) => p.id === provider)?.url}
        </small>
        <label>
          API Key
          <input
            type="password"
            autoComplete="new-password"
            maxLength={4096}
            value={key}
            placeholder={
              config && provider === config.provider
                ? t("留空保留已有密钥")
                : undefined
            }
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <label className="ai-check">
          <input
            type="checkbox"
            checked={defaultValue}
            onChange={(e) => setDefault(e.target.checked)}
          />
          {t("设为默认")}
        </label>
      </fieldset>
      <p className="muted">
        {t("验证会发起一次搜索和一次抓取，可能产生费用。")}
      </p>
      {error && (
        <p role="alert" className="error-text">
          {t(error)}
        </p>
      )}
      <div className="ai-form-actions">
        <Button
          type="button"
          variant="outline"
          disabled={
            checking ||
            saving ||
            !!verified ||
            !name.trim() ||
            (!key.trim() && !config)
          }
          onClick={async () => {
            const snapshot = fingerprint;
            setChecking(true);
            setError("");
            controller.current = new AbortController();
            try {
              const v = await request<{
                verification_token: string;
                expires_at: string;
              }>("/assistant/web-configs/verify", {
                method: "POST",
                body: JSON.stringify(body()),
                signal: controller.current.signal,
              });
              if (mounted.current && latest.current === snapshot)
                setProof({
                  fingerprint: snapshot,
                  token: v.verification_token,
                  expires: Date.parse(v.expires_at),
                });
            } catch (e) {
              if (mounted.current && latest.current === snapshot) {
                setProof(null);
                setError((e as Error).message);
              }
            } finally {
              if (mounted.current) setChecking(false);
            }
          }}
        >
          {checking ? (
            <Loader2 size={14} className="animate-spin" />
          ) : verified ? (
            <Check size={14} />
          ) : null}
          {t(checking ? "验证中…" : verified ? "已验证" : "验证")}
        </Button>
        <Button
          type="submit"
          disabled={!verified || checking || saving || !name.trim()}
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {t("保存配置")}
        </Button>
      </div>
    </form>
  );
}
