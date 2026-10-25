"use client";

import { useI18n } from "@/components/i18n-provider";
import { useEffect, useRef, useState } from "react";
import { ChevronUp, Loader2, LogOut, UserRound } from "lucide-react";
import { PersonalProfile } from "@/components/personal-profile";
import { AccountLanguage } from "@/components/account-language";
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
  const { t: tr } = useI18n();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(false);
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
        aria-label={tr("账号菜单：{0}", {
          0: name,
        })}
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
      {profile && <PersonalProfile onClose={() => setProfile(false)} />}
      {open && (
        <div
          className="account-popover"
          role="group"
          aria-label={tr("账号菜单")}
        >
          <strong>{name}</strong>
          <small>{auth.me?.user.email || role}</small>
          {auth.mode !== "local-demo" && <button type="button" onClick={() => { setOpen(false); setProfile(true); }}><UserRound size={15} />{tr("个人信息")}</button>}
          <AccountLanguage />
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
              {tr("退出登录")}
            </button>
          )}
          {error && (
            <p className="error-text" role="alert">
              {tr(error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
