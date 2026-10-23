"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronUp, Loader2, LogOut } from "lucide-react";
import { useAuth } from "@/components/auth-gate";

export function AccountMenu({
  avatar,
  name,
  role,
}: {
  avatar: React.ReactNode;
  name: string;
  role: string;
}) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      ref={root}
      className="account-menu"
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
        className="profile profile-trigger"
        aria-label={`账号菜单：${name}`}
        aria-expanded={open}
        title={name}
        onClick={() => {
          setOpen((v) => !v);
          setError("");
        }}
      >
        {avatar}
        <div>
          <strong>{name}</strong>
          <small>{role}</small>
        </div>
        <ChevronUp size={13} className="profile-chevron" />
      </button>
      {open && (
        <div className="account-popover" role="group" aria-label="账号菜单">
          <strong>{name}</strong>
          <small>{auth.me?.user.email || role}</small>
          {auth.mode !== "local-demo" && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await auth.logout();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <LogOut size={15} />
              )}
              退出登录
            </button>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
