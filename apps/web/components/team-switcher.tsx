"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-gate";
import { publicDemo } from "@/lib/runtime";
import { request } from "@/lib/types";

export function TeamSwitcher({
  teamName,
  onNavigate,
}: {
  teamName: string;
  onNavigate: () => void;
}) {
  const auth = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  async function switchTeam(id: string) {
    if (busy) return;
    if (id === auth.me?.current_team) {
      setOpen(false);
      return;
    }
    setBusy(id);
    setError("");
    try {
      await request("/auth/team", {
        method: "POST",
        body: JSON.stringify({ team_id: id }),
      });
      auth.setCredential("");
      await auth.refresh();
      setOpen(false);
      onNavigate();
      router.push("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div
      className="workspace-switcher"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="workspace"
        aria-label={`切换团队：${teamName}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setError("");
        }}
        title={teamName}
      >
        <Users size={17} />
        <strong>{teamName}</strong>
        <ChevronDown size={13} className="workspace-chevron" />
      </button>
      {open && (
        <div className="team-switch-menu" role="group" aria-label="团队切换">
          {auth.mode === "local-demo" ? (
            <p className="muted">{publicDemo ? "公开演示 · Flow Studio" : "本地演示团队"}</p>
          ) : (
            <>
              {auth.me?.teams.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  disabled={!!busy}
                  className={t.id === auth.me?.current_team ? "current" : ""}
                  aria-current={
                    t.id === auth.me?.current_team ? "true" : undefined
                  }
                  onClick={() => void switchTeam(t.id)}
                >
                  <span>
                    {t.name}
                    <small>{t.display_name}</small>
                  </span>
                  {busy === t.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : t.id === auth.me?.current_team ? (
                    <Check size={14} />
                  ) : null}
                </button>
              ))}
              <Link
                href="/teams/new"
                className="new-team-link"
                onClick={() => {
                  setOpen(false);
                  onNavigate();
                }}
              >
                <Plus size={15} />
                新建团队
              </Link>
            </>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
