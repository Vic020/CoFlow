"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  UserPlus,
  Users,
  Mail,
  FolderKanban,
  Tags,
} from "lucide-react";
import { CatalogManager } from "@/components/catalog-manager";
import { Button } from "@/components/ui/button";
import { Meta, request } from "@/lib/types";

type Invite = {
  id: string;
  email: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
};
export function TeamSettings({
  meta,
  onChange,
}: {
  meta: Meta;
  onChange: () => void;
}) {
  const [tab, setTab] = useState<"members" | "invites" | "project" | "domain">(
    "members",
  );
  const [invites, setInvites] = useState<Invite[]>([]),
    [email, setEmail] = useState(""),
    [link, setLink] = useState("");
  const [issuedInvite, setIssuedInvite] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    try {
      setInvites((await request<{ items: Invite[] }>("/invites")).items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (meta.mode !== "local-demo") void load();
  }, [load, meta.mode]);
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setLink("");
    setCopied(false);
    try {
      const v = await request<{ token: string; invite: { id: string } }>(
        "/invites",
        {
          method: "POST",
          body: JSON.stringify({ email }),
        },
      );
      setLink(`${window.location.origin}/invite#invite=${v.token}`);
      setIssuedInvite(v.invite.id);
      setEmail("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(path: string) {
    setBusy(true);
    setError("");
    try {
      await request(path, { method: "DELETE" });
      if (path === `/invites/${issuedInvite}`) setLink("");
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="team-settings-page">
      <nav className="settings-categories" aria-label="团队设置分类">
        <button
          type="button"
          aria-current={tab === "members" ? "page" : undefined}
          onClick={() => setTab("members")}
        >
          <Users size={15} />
          成员
        </button>
        <button
          type="button"
          aria-current={tab === "invites" ? "page" : undefined}
          onClick={() => setTab("invites")}
        >
          <Mail size={15} />
          邀请
        </button>
        {(
          [
            ["project", "项目", FolderKanban],
            ["domain", "领域", Tags],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            aria-current={tab === value ? "page" : undefined}
            onClick={() => setTab(value)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-panel">
        {(tab === "project" || tab === "domain") && (
          <CatalogManager
            key={tab}
            meta={meta}
            categoryKind={tab}
            onChange={onChange}
          />
        )}
        {tab === "invites" && meta.mode !== "local-demo" && (
          <>
            <h3>邀请成员</h3>
            <form className="invite-form" onSubmit={invite}>
              <label className="sr-only" htmlFor="invite-email">
                受邀成员邮箱
              </label>
              <input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="输入成员邮箱"
              />
              <Button type="submit" disabled={busy || !email.trim()} size="sm">
                {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
                生成邀请
              </Button>
            </form>
            {link && (
              <div className="issued-secret">
                <label htmlFor="invite-link">
                  邀请链接 · 7 天有效，仅能接受一次
                </label>
                <textarea
                  id="invite-link"
                  readOnly
                  rows={3}
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link);
                      setCopied(true);
                    } catch {
                      setError("请选中邀请链接手动复制");
                    }
                  }}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? "已复制" : "复制邀请链接"}
                </Button>
                <p>请将链接发给对应成员。完整链接仅此次生成时显示。</p>
              </div>
            )}
          </>
        )}
        {tab === "members" && (
          <>
            <div className="settings-section-heading">
              <h2>
                成员 <span>{meta.members.length}</span>
              </h2>
              {meta.mode !== "local-demo" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTab("invites")}
                >
                  <UserPlus />
                  邀请成员
                </Button>
              )}
            </div>
            <div className="management-list">
              {meta.members.map((m) => (
                <div className="management-row" key={m.id}>
                  <span className={`avatar small ${m.color}`}>
                    {m.name.slice(0, 1)}
                  </span>
                  <div>
                    <strong>
                      {m.name}
                      {m.id === meta.current_user ? "（我）" : ""}
                    </strong>
                    <small>
                      {meta.mode === "local-demo"
                        ? m.role
                        : m.role === "admin"
                          ? "管理员"
                          : "成员"}
                    </small>
                  </div>
                  {meta.mode !== "local-demo" &&
                    meta.role === "admin" &&
                    m.role !== "admin" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void revoke(`/members/${m.id}`)}
                      >
                        移除
                      </Button>
                    )}
                </div>
              ))}
            </div>
          </>
        )}
        {tab === "invites" && invites.length > 0 && (
          <>
            <h3>邀请记录</h3>
            <div className="management-list">
              {invites.map((i) => {
                const active =
                  !i.used_at &&
                  !i.revoked_at &&
                  new Date(i.expires_at).getTime() > Date.now();
                return (
                  <div className="management-row" key={i.id}>
                    <div>
                      <strong>{i.email}</strong>
                      <small>
                        {i.used_at
                          ? "已加入"
                          : i.revoked_at
                            ? "已撤销"
                            : !active
                              ? "已过期"
                              : `待加入 · ${new Date(i.expires_at).toLocaleDateString("zh-CN")} 到期`}
                      </small>
                    </div>
                    {active && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void revoke(`/invites/${i.id}`)}
                      >
                        撤销
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {tab === "invites" && meta.mode === "local-demo" && (
          <p className="muted">演示模式不发送邀请。</p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
