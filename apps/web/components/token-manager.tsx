"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Plus } from "lucide-react";
import { useAuth } from "@/components/auth-gate";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAgentPrompt } from "@/lib/agent-prompt";
import { Meta, request } from "@/lib/types";

type Token = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
};
const isActive = (token: Token) =>
  !token.revoked_at && Date.parse(token.expires_at) > Date.now();
const date = (value: string) => new Date(value).toLocaleDateString("zh-CN");

export function TokenManager() {
  const { me, credential, setCredential, refreshTokens } = useAuth();
  const { copyPrompt, copied, copyError, origin } = useAgentPrompt();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("Codex");
  const [days, setDays] = useState("90");
  const [scope, setScope] = useState("report");
  const [existing, setExisting] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tokenCopied, setTokenCopied] = useState(false);
  const [issued, setIssued] = useState("");
  const mounted = useRef(false);
  function closeSecret() {
    setIssued("");
    setCredential("");
    setTokenCopied(false);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setCredential("");
    };
  }, [setCredential]);
  const load = useCallback(async () => {
    try {
      setTokens((await request<{ items: Token[] }>("/tokens")).items);
      await refreshTokens();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [refreshTokens]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setTokenCopied(false);
  }, [credential]);
  useEffect(() => {
    if (!tokenCopied) return;
    const timer = setTimeout(() => setTokenCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [tokenCopied]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const scopes =
        scope === "read"
          ? ["reports:read"]
          : scope === "comment"
            ? ["reports:read", "reports:write", "comments:write"]
            : ["reports:read", "reports:write"];
      const v = await request<{ credential: string }>("/tokens", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          expires_in_days: Number(days),
        }),
      });
      if (!mounted.current) return;
      setCredential(v.credential);
      setIssued(v.credential);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(t: Token) {
    setBusy(true);
    setError("");
    try {
      await request(`/tokens/${t.id}`, { method: "DELETE" });
      if (credential.startsWith(t.prefix)) setCredential("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function useExisting() {
    setBusy(true);
    setError("");
    try {
      const raw = existing.trim();
      const metadata = await request<Meta>("/meta", {
        headers: { Authorization: `Bearer ${raw}` },
      });
      if (
        metadata.current_user !== me?.user.id ||
        metadata.team.id !== me.current_team
      )
        throw new Error("凭证必须属于当前账号和当前团队");
      if (!mounted.current) return;
      setCredential(raw);
      setIssued(raw);
      setExisting("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copyCredential() {
    try {
      await navigator.clipboard.writeText(credential);
      setTokenCopied(true);
      setError("");
    } catch {
      setError("无法访问剪贴板，请选中凭证手动复制。");
    }
  }

  return (
    <section className="credentials-manager">
      <form className="token-form credentials-create" onSubmit={create}>
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={40}
            placeholder="如：Codex · 本机"
            disabled={busy}
          />
        </label>
        <label>
          权限
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            disabled={busy}
          >
            <option value="report">读取与上报</option>
            <option value="comment">读取、上报与评论</option>
            <option value="read">只读</option>
          </select>
        </label>
        <label>
          有效期
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={busy}
          >
            {[7, 30, 90, 365].map((d) => (
              <option key={d} value={d}>
                {d} 天
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />}创建凭证
        </Button>
      </form>
      <Dialog
        open={!!issued}
        onOpenChange={(open) => {
          if (!open) closeSecret();
        }}
      >
        <DialogContent className="credential-secret-dialog info-dialog">
          <DialogTitle className="modal-title">保存你的凭证</DialogTitle>
          <DialogDescription className="modal-description">
            仅展示一次，关闭后无法再次查看。
          </DialogDescription>
          <label className="sr-only" htmlFor="issued-token">
            Agent 凭证明文
          </label>
          <textarea
            id="issued-token"
            className="credential-plaintext"
            readOnly
            value={issued}
            rows={3}
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="credential-dialog-actions">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyCredential()}
            >
              {tokenCopied ? <Check /> : <Copy />}
              {tokenCopied ? "已复制" : "复制凭证"}
            </Button>
            <Button
              size="sm"
              onClick={() => void copyPrompt()}
              disabled={!origin}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "已复制" : "复制上报 Prompt"}
            </Button>
          </div>
          {copyError && (
            <p role="alert" className="error-text">
              {copyError}
            </p>
          )}
          <button
            type="button"
            className="credential-saved"
            onClick={closeSecret}
          >
            我已保存，关闭
          </button>
        </DialogContent>
      </Dialog>
      {(error || copyError) && (
        <p className="error-text" role="alert">
          {error || copyError}
        </p>
      )}
      <div className="credentials-list-heading">
        <h2>
          我的凭证 <span>{tokens.length}</span>
        </h2>
        <span>仅当前团队</span>
      </div>
      {loading ? (
        <div className="credentials-empty">
          <Loader2 className="animate-spin" />
          正在读取凭证…
        </div>
      ) : tokens.length ? (
        <div className="credentials-list">
          {[...tokens]
            .sort((a, b) => Number(isActive(b)) - Number(isActive(a)))
            .map((t) => {
              const active = isActive(t);
              return (
                <div className="credential-row" key={t.id}>
                  <span
                    className={`credential-icon${active ? "" : " inactive"}`}
                  >
                    <KeyRound size={18} />
                  </span>
                  <div className="credential-identity">
                    <strong>{t.name}</strong>
                    <code>{t.prefix}…</code>
                  </div>
                  <div className="credential-permissions">
                    {t.scopes.includes("comments:write")
                      ? "读取、上报与评论"
                      : t.scopes.includes("reports:write")
                        ? "读取与上报"
                        : "只读"}
                    <small>
                      {t.last_used_at
                        ? `最近使用 ${date(t.last_used_at)}`
                        : "尚未使用"}
                    </small>
                  </div>
                  <div
                    className={`credential-state${active ? "" : " inactive"}`}
                  >
                    {t.revoked_at ? "已撤销" : !active ? "已过期" : "有效"}
                    <small>{date(t.expires_at)} 到期</small>
                  </div>
                  {active ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void revoke(t)}
                      aria-label={`撤销 ${t.name}`}
                    >
                      撤销
                    </Button>
                  ) : (
                    <span className="credential-action-spacer" />
                  )}
                </div>
              );
            })}
        </div>
      ) : (
        <div className="credentials-empty">
          <KeyRound size={22} />
          <span>{error ? "暂时无法读取凭证" : "还没有凭证"}</span>
          {error && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError("");
                setLoading(true);
                void load();
              }}
            >
              重试
            </Button>
          )}
        </div>
      )}
      <details className="existing-credential">
        <summary>使用已保存的凭证</summary>
        <div className="credentials-existing-row">
          <label className="sr-only" htmlFor="existing-token">
            已保存的 Agent 凭证
          </label>
          <input
            id="existing-token"
            type="password"
            autoComplete="off"
            value={existing}
            onChange={(e) => setExisting(e.target.value)}
            placeholder="粘贴 cf_ 开头的凭证"
            disabled={busy}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !existing.trim()}
            onClick={() => void useExisting()}
          >
            验证并使用
          </Button>
        </div>
      </details>
    </section>
  );
}
