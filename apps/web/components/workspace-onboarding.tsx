"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CoFlowLogo } from "@/components/coflow-logo";
import { request } from "@/lib/types";

const steps = ["为团队命名", "认识一下你", "准备启航"];

export function WorkspaceOnboarding({
  onDone,
  onCreateTeam,
  initialName = "",
}: {
  onDone: () => void;
  onCreateTeam?: (team: string, name: string) => Promise<void>;
  initialName?: string;
}) {
  const [step, setStep] = useState(0);
  const [team, setTeam] = useState("");
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [setupAccess, setSetupAccess] = useState<"checking" | "allowed" | "blocked">("checking");
  const setupCheck = useRef<Promise<string> | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (onCreateTeam) return;
    if (!setupCheck.current) {
      const url = new URL(window.location.href);
      const token = url.searchParams.get("token") || "";
      if (url.searchParams.has("token")) {
        url.searchParams.delete("token");
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      }
      setupCheck.current = token
        ? request("/auth/bootstrap/check", {
            method: "POST",
            headers: { "X-CoFlow-Setup-Token": token },
            body: "{}",
          }).then(() => token)
        : Promise.reject(new Error("Missing initialization link"));
    }
    let active = true;
    setupCheck.current.then((token) => {
      if (!active) return;
      setSetupToken(token);
      setSetupAccess("allowed");
    }).catch(() => {
      if (active) setSetupAccess("blocked");
    });
    return () => { active = false; };
  }, [onCreateTeam]);

  useEffect(() => {
    firstField.current?.focus();
  }, [step, setupAccess]);

  function goTo(next: number) {
    setError("");
    setVisible(false);
    setStep(next);
  }

  if (!onCreateTeam && setupAccess !== "allowed") {
    return (
      <main className="account-page onboarding-page">
        <div className="account-brand"><CoFlowLogo /><strong>CoFlow</strong></div>
        <section className="account-card" aria-live="polite">
          <h1>{setupAccess === "checking" ? "正在验证初始化链接…" : "初始化链接无效或已失效"}</h1>
        </section>
      </main>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step < (onCreateTeam ? 1 : 2)) {
      const value = step === 0 ? team : name;
      if (!value.trim()) {
        setError(
          step === 0 ? "先给团队起个名字吧。" : "告诉我们该怎么称呼你吧。",
        );
        firstField.current?.focus();
        return;
      }
      if (step === 0) setTeam(team.trim());
      else setName(name.trim());
      goTo(step + 1);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (onCreateTeam) {
        if (!name.trim()) {
          setError("告诉我们该怎么称呼你吧。");
          return;
        }
        await onCreateTeam(team.trim(), name.trim());
      } else
        await request("/auth/bootstrap", {
          method: "POST",
          headers: { "X-CoFlow-Setup-Token": setupToken },
          body: JSON.stringify({
            team_name: team.trim(),
            name: name.trim(),
            email: email.trim(),
            password,
          }),
        });
      setPassword("");
      setSetupToken("");
      setVisible(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="account-page onboarding-page">
      <div className="account-brand">
        <CoFlowLogo />
        <strong>CoFlow</strong>
      </div>
      <section
        className="account-card onboarding-card"
        aria-label="创建工作空间"
      >
        <ol className="onboarding-steps" aria-label="创建进度">
          {(onCreateTeam ? steps.slice(0, 2) : steps).map((label, index) => (
            <li
              key={label}
              className={
                index < step
                  ? "is-complete"
                  : index === step
                    ? "is-current"
                    : ""
              }
              aria-label={`${label}${index < step ? "，已完成" : ""}`}
              aria-current={index === step ? "step" : undefined}
            >
              <span className="onboarding-step-track" />
            </li>
          ))}
        </ol>
        <div className="onboarding-scene" aria-hidden="true">
          <span className="onboarding-orbit orbit-one" />
          <span className="onboarding-orbit orbit-two" />
          <span className="onboarding-emblem">
            <CoFlowLogo />
          </span>
          <span className="onboarding-spark">
            <Sparkles />
          </span>
          <span className="onboarding-orbit-dot" />
        </div>
        <div className="onboarding-stage" key={step}>
          <div className="onboarding-heading" aria-live="polite">
            <h1>
              {step === 0
                ? "先给团队起个名字。"
                : step === 1
                  ? `「${team}」，认识一下你。`
                  : `「${team}」，欢迎 ${name} 登船。`}
            </h1>
          </div>
          <form className="account-form" onSubmit={submit} aria-busy={busy}>
            {step === 0 ? (
              <label htmlFor="onboarding-team">
                <span className="sr-only">团队名称</span>
                <input
                  ref={firstField}
                  id="onboarding-team"
                  required
                  maxLength={40}
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  placeholder="比如：引力工作室"
                  autoComplete="organization"
                />
              </label>
            ) : step === 1 ? (
              <label htmlFor="onboarding-name">
                <span className="sr-only">怎么称呼你</span>
                <input
                  ref={firstField}
                  id="onboarding-name"
                  required
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="比如：Vic"
                  autoComplete="name"
                />
              </label>
            ) : (
              <>
                <label htmlFor="onboarding-email">
                  <span className="sr-only">邮箱</span>
                  <input
                    ref={firstField}
                    id="onboarding-email"
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="邮箱"
                    disabled={busy}
                  />
                </label>
                <div className="account-password-group">
                  <label className="sr-only" htmlFor="onboarding-password">
                    设置密码
                  </label>
                  <span className="account-password-field">
                    <input
                      id="onboarding-password"
                      type={visible ? "text" : "password"}
                      required
                      minLength={8}
                      maxLength={72}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="设置密码，至少 8 位"
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="account-password-toggle"
                      aria-label={visible ? "隐藏密码" : "显示密码"}
                      aria-pressed={visible}
                      onClick={() => setVisible((v) => !v)}
                      disabled={busy}
                    >
                      {visible ? (
                        <EyeOff aria-hidden="true" />
                      ) : (
                        <Eye aria-hidden="true" />
                      )}
                    </button>
                  </span>
                </div>
              </>
            )}
            {error && (
              <p className="account-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="onboarding-next">
              {busy ? <Loader2 className="animate-spin" /> : null}
              {step === 0
                ? "团队就叫这个"
                : step === 1
                  ? onCreateTeam
                    ? busy
                      ? "正在创建…"
                      : "创建团队"
                    : "认识了，继续"
                  : busy
                    ? "正在创建工作空间…"
                    : "创建团队，启航"}
              {!busy && <ArrowRight aria-hidden="true" />}
            </Button>
            {onCreateTeam && step === 0 && (
              <Link href="/" className="onboarding-back">
                返回工作空间
              </Link>
            )}
            {step > 0 && (
              <button
                type="button"
                className="onboarding-back"
                onClick={() => goTo(step - 1)}
                disabled={busy}
              >
                <ArrowLeft aria-hidden="true" />
                上一步
              </button>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
