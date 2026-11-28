"use client";

import { useI18n } from "@/components/i18n-provider";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ClipboardCheck, Copy, KeyRound, Loader2, Plus, Terminal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { CLIRequestReview } from "./cli-request-review";
import { CLIDeviceApproval } from "./cli-device-approval";
import { useAuth } from "@/components/auth-gate";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAgentPrompt } from "@/lib/agent-prompt";
import { credentialCapabilities, isActiveAgentToken as isActive } from "@/lib/report-prompt";
import { Meta, request } from "@/lib/types";
type Token = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
};

const permissionModules = [
  { label: "Timeline 简报", detail: "发布、更新简报", read: "reports:read", write: "reports:write" },
  { label: "Todo 任务", detail: "新建、更新、归档任务", read: "todos:read", write: "todos:write", writeNeedsRead: true },
  { label: "Calendar 日历", detail: "新建、更新、归档日历节点", read: "calendar:read", write: "calendar:write", writeNeedsRead: true },
  { label: "Context 知识", detail: "新建、更新、归档知识", read: "context:read", write: "context:write", writeNeedsRead: true },
  { label: "评论与协作", detail: "发表评论、处理协作请求", read: null, write: "comments:write" },
] as const;
type PermissionModule = (typeof permissionModules)[number];
const permissionActions = [["read", "读取"], ["write", "写入"]] as const;
const collaborationScopes = ["reports:read", "reports:write", "todos:read", "todos:write"];

export function TokenManager() {
  const { t: tr, date: formatDate } = useI18n();
  const { me, credential, setCredential, refreshTokens } = useAuth();

  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("tab");
  const tab = selected === "review" || selected === "tokens" ? selected : "connect";

  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("Codex");
  const [days, setDays] = useState("90");
  const [scopes, setScopes] = useState(["reports:read", "reports:write"]);
  const hasReadScope = permissionModules.some(({ read }) => read && scopes.includes(read));
  const [issuedTaskAccess, setIssuedTaskAccess] = useState(false);
  const [issuedScopes, setIssuedScopes] = useState<string[] | undefined>();
  const [replaceExisting, setReplaceExisting] = useState(false);
  const { copyPrompt, prompt, copied, copyError, origin } = useAgentPrompt(
    issuedTaskAccess,
    { scopes: issuedScopes, replaceExisting },
  );
  const [existing, setExisting] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState("");
  const mounted = useRef(false);
  const permissionStart = useRef<HTMLInputElement>(null);
  function closeSecret() {
    setIssued("");
    setCredential("");
    setReplaceExisting(false);
    setIssuedScopes(undefined);
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
      setTokens(
        (
          await request<{
            items: Token[];
          }>("/tokens")
        ).items,
      );
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
  function toggleScope(module: PermissionModule, action: "read" | "write", checked: boolean) {
    const scope = module[action];
    if (!scope) return;
    const needsRead = "writeNeedsRead" in module;
    setScopes((previous) => {
      if (!checked) {
        return previous.filter((value) =>
          value !== scope && !(needsRead && action === "read" && value === module.write),
        );
      }
      const next = new Set(previous);
      if (needsRead && action === "write") next.add(module.read);
      next.add(scope);
      return [...next];
    });
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim() || !hasReadScope) return;
    setBusy(true);
    setError("");
    try {
      const v = await request<{
        credential: string;
      }>("/tokens", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          ...(days === "never" ? { never_expires: true } : { expires_in_days: Number(days) }),
        }),
      });
      if (!mounted.current) return;
      setCredential(v.credential);
      setIssuedScopes(scopes);
      setReplaceExisting(false);
      setIssuedTaskAccess(scopes.includes("todos:read"));
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
      await request(`/tokens/${t.id}`, {
        method: "DELETE",
      });
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
        headers: {
          Authorization: `Bearer ${raw}`,
        },
      });
      if (
        metadata.current_user !== me?.user.id ||
        metadata.team.id !== me.current_team
      )
        throw new Error("凭证必须属于当前账号和当前团队");
      if (!mounted.current) return;
      setCredential(raw);
      const matches = tokens.filter(
        (t) => isActive(t) && raw.startsWith(t.prefix),
      );
      setIssuedScopes(matches.length === 1 ? matches[0].scopes : undefined);
      setReplaceExisting(false);
      setIssuedTaskAccess(
        tokens.some(
          (t) => raw.startsWith(t.prefix) && t.scopes.includes("todos:read"),
        ),
      );
      setIssued(raw);
      setExisting("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="team-settings-page credentials-settings-page">
      <nav className="settings-categories" aria-label={tr("Agent 凭证")}>
        {([
          ["connect", "连接 CLI", Terminal],
          ["review", "审查 CLI 请求", ClipboardCheck],
          ["tokens", "我的凭证", KeyRound],
        ] as const).map(([value, label, Icon]) => (
          <button type="button" key={value} aria-current={tab === value ? "page" : undefined}
            onClick={() => router.replace(`/credentials?tab=${value}`, { scroll: false })}>
            <Icon size={15} />
            {tr(label)}
          </button>
        ))}
      </nav>
      <div className="settings-panel credentials-manager">
        {tab === "connect" && <CLIDeviceApproval onRefresh={load} />}
        {tab === "review" && (
          <div className="credentials-review-panel">
            <h2>{tr("审查 CLI 请求")}</h2>
            <CLIRequestReview />
          </div>
        )}
        <div hidden={tab !== "tokens"}>
      <form className="token-form credentials-create" onSubmit={create}>
        <label>
          {tr("名称")}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={40}
            placeholder={tr("如：Codex · 本机")}
            disabled={busy}
          />
        </label>
        <label>
          {tr("有效期")}
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={busy}
          >
            {[7, 30, 90, 365].map((d) => (
              <option key={d} value={d}>
                {tr("{count} 天", {
                  count: d,
                })}
              </option>
            ))}
            <option value="never">{tr("永久")}</option>
          </select>
        </label>
        <fieldset className="credential-scope-fields" disabled={busy} aria-describedby="credential-scope-help">
          <legend>{tr("权限")}</legend>
          <table className="credential-scope-matrix">
            <thead>
              <tr>
                <th scope="col">{tr("模块")}</th>
                <th scope="col">{tr("读取")}</th>
                <th scope="col">{tr("写入")}</th>
                <th scope="col">{tr("删除")}</th>
              </tr>
            </thead>
            <tbody>
              {permissionModules.map((module) => (
                <tr key={module.write}>
                  <th scope="row">
                    {tr(module.label)}
                    <small>{tr(module.detail)}</small>
                  </th>
                  {permissionActions.map(([action, label]) => {
                    const scope = module[action];
                    return (
                      <td key={action}>
                        {scope ? (
                          <label className="credential-scope-option">
                            <input
                              ref={scope === "reports:read" ? permissionStart : undefined}
                              type="checkbox"
                              aria-label={tr("{module} · {action}", { module: tr(module.label), action: tr(label) })}
                              checked={scopes.includes(scope)}
                              onChange={(e) => toggleScope(module, action, e.target.checked)}
                            />
                          </label>
                        ) : <span className="credential-scope-unavailable">{tr("复用简报或任务的读取权限")}</span>}
                      </td>
                    );
                  })}
                  <td><span className="credential-scope-unavailable" aria-label={tr("不可授权")}>—</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p id="credential-scope-help" className="credential-scope-help">
            {tr("至少选择一项读取权限。Todo、Calendar 和 Context 的写入需要同模块的读取权限。删除操作只能通过网页执行。")}
          </p>
        </fieldset>
        <Button type="submit" disabled={busy || !name.trim() || !hasReadScope}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />}
          {tr("创建凭证")}
        </Button>
      </form>
      <Dialog
        open={!!issued}
        onOpenChange={(open) => {
          if (!open) closeSecret();
        }}
      >
        <DialogContent className="credential-secret-dialog info-dialog">
          <DialogTitle className="modal-title">
            {tr("安装到 Agent")}
          </DialogTitle>
          <DialogDescription className="modal-description">
            {tr("仅展示一次。交给当前项目的 Agent，安装 Skill 和本机凭证。")}
          </DialogDescription>
          <label className="sr-only" htmlFor="issued-token">
            {tr("安装提示词")}
          </label>
          <textarea
            id="issued-token"
            className="credential-plaintext"
            readOnly
            value={prompt}
            rows={7}
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
          />
          <p className="credential-next-command">
            {tr("安装后，对 Agent 说：")}
            <code>
              {tr(
                issuedScopes?.includes("todos:write")
                  ? "管理 CoFlow 任务"
                  : issuedScopes?.includes("reports:write")
                    ? "上报 CoFlow"
                    : "读取 CoFlow 工作",
              )}
            </code>
          </p>
          <label className="credential-replacement">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
            />
            {tr("授权替换同团队、同成员的本机旧凭证")}
          </label>
          <div className="credential-dialog-actions">
            <Button
              size="sm"
              onClick={() => void copyPrompt()}
              disabled={!origin}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? tr("已复制") : tr("复制安装提示词")}
            </Button>
          </div>
          {copyError && (
            <p role="alert" className="error-text">
              {tr(copyError)}
            </p>
          )}
        </DialogContent>
      </Dialog>
      {(error || copyError) && (
        <p className="error-text" role="alert">
          {tr(error || copyError)}
        </p>
      )}
      <div className="credentials-list-heading">
        <h2>
          {tr("我的凭证")}
          <span>{tokens.length}</span>
        </h2>
        <span>{tr("仅当前团队")}</span>
      </div>
      <p className="credential-guidance">
        {tr(
          "凭证按权限区分，不代表 Skill 版本。任务与简报联动需同时具备两组读写权限；已有凭证不会自动扩权。",
        )}
      </p>
      {loading ? (
        <div className="credentials-empty">
          <Loader2 className="animate-spin" />
          {tr("正在读取凭证…")}
        </div>
      ) : tokens.length ? (
        <div className="credentials-list">
          {[...tokens]
            .sort((a, b) => Number(isActive(b)) - Number(isActive(a)))
            .map((t) => {
              const active = isActive(t);
              const capability = credentialCapabilities(t.scopes);
              const upgrade =
                active && !t.prefix.startsWith("cf_cli_") &&
                !capability.collaboration &&
                (capability.reports || capability.todos);
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
                    <div className="credential-scope-list">
                      {t.scopes.map((scope) => {
                        const module = permissionModules.find(({ read, write }) => scope === read || scope === write);
                        return <span key={scope} title={scope}>
                          {module ? tr("{module} · {action}", {
                            module: tr(module.label),
                            action: scope === module.read ? tr("读取") : tr("写入"),
                          }) : scope}
                        </span>;
                      })}
                    </div>
                    {upgrade && (
                      <span className="credential-upgrade">
                        {tr("联动任务与简报时建议升级")}
                      </span>
                    )}
                    <small>
                      {t.last_used_at
                        ? tr("最近使用 {0}", {
                            0: formatDate(t.last_used_at),
                          })
                        : tr("尚未使用")}
                    </small>
                  </div>
                  <div
                    className={`credential-state${active ? "" : " inactive"}`}
                  >
                    {t.revoked_at
                      ? tr("已撤销")
                      : !active
                        ? tr("已过期")
                        : tr("有效")}
                    <small>
                      {t.expires_at === null ? tr("永久") : tr("{0} 到期", { 0: formatDate(t.expires_at) })}
                    </small>
                  </div>
                  {active ? (
                    <div className="credential-row-actions">
                      {upgrade && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setScopes([...new Set([...t.scopes, ...collaborationScopes])]);
                            setName(t.name);
                            permissionStart.current?.focus();
                          }}
                        >
                          {tr("配置协作凭证")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void revoke(t)}
                        aria-label={tr("撤销 {0}", {
                          0: t.name,
                        })}
                      >
                        {tr("撤销")}
                      </Button>
                    </div>
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
          <span>{error ? tr("暂时无法读取凭证") : tr("还没有凭证")}</span>
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
              {tr("重试")}
            </Button>
          )}
        </div>
      )}
      <details className="existing-credential">
        <summary>{tr("使用已保存的凭证")}</summary>
        <div className="credentials-existing-row">
          <label className="sr-only" htmlFor="existing-token">
            {tr("已保存的 Agent 凭证")}
          </label>
          <input
            id="existing-token"
            type="password"
            autoComplete="off"
            value={existing}
            onChange={(e) => setExisting(e.target.value)}
            placeholder={tr("粘贴 cf_ 开头的凭证")}
            disabled={busy}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !existing.trim()}
            onClick={() => void useExisting()}
          >
            {tr("验证并使用")}
          </Button>
        </div>
      </details>
        </div>
      </div>
    </section>
  );
}
