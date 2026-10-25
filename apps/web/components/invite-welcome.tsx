"use client";

import { InvitationHint } from "@/components/invitation-hint";
import type { InvitationInfo } from "@/lib/types";
import { LanguageSwitcher, useI18n } from "@/components/i18n-provider";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  Terminal,
  Users,
} from "lucide-react";
import { CoFlowLogo } from "@/components/coflow-logo";
import { request } from "@/lib/types";
import styles from "./invite-welcome.module.css";
const steps = [
  {
    icon: Terminal,
    title: "Agent 上报",
    description: "简报与交付链接，自动归位",
  },
  {
    icon: Users,
    title: "团队浏览",
    description: "一条时间线，了解每个人的推进",
  },
  {
    icon: MessageCircle,
    title: "评论协作",
    description: "讨论阻塞，提出协作请求",
  },
  {
    icon: RefreshCw,
    title: "持续更新",
    description: "后续进展接着走，协作有回音",
  },
];
export function InviteWelcome() {
  const { t: tr } = useI18n();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let revision = 0;
    async function readInvite() {
      const current = ++revision;
      const value =
        new URLSearchParams(window.location.hash.slice(1)).get("invite") || "";
      setToken(value);
      setInfo(null);
      setError("");
      if (!value) {
        setChecking(false);
        return;
      }
      setChecking(true);
      try {
        const result = await request<InvitationInfo>("/auth/invite-info", {
          method: "POST",
          body: JSON.stringify({
            token: value,
          }),
        });
        if (active && current === revision) setInfo(result);
      } catch (e) {
        if (active && current === revision) setError((e as Error).message);
      } finally {
        if (active && current === revision) setChecking(false);
      }
    }
    void readInvite();
    window.addEventListener("hashchange", readInvite);
    return () => {
      active = false;
      window.removeEventListener("hashchange", readInvite);
    };
  }, []);
  function continueWithEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) {
      setError("请使用团队成员分享的完整邀请链接，再填写受邀邮箱继续。");
      return;
    }
    if (!info) return;
    if (email.trim().toLowerCase() !== info.email.toLowerCase()) {
      setError("邮箱与此邀请不匹配，请填写接收邀请时使用的邮箱。");
      return;
    }
    window.location.assign(`/#invite=${encodeURIComponent(token)}`);
  }
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label={tr("CoFlow 首页")}>
          <CoFlowLogo />
          <span>CoFlow</span>
        </Link>
        <div className={styles.headerActions}>
          <Link href="/" className={styles.login}>
            <span className={styles.loginHint}>{tr("已有账号？")}</span>
            <span>
              {tr("前往工作空间")}
              <ArrowRight size={14} />
            </span>
          </Link>
          <LanguageSwitcher inline />
        </div>
      </header>

      <section className={styles.content} aria-labelledby="invite-title">
        <div className={styles.intro}>
          <span className={styles.eyebrow}>
            <span />
            {tr("AI 时代的工作协作方式")}
          </span>
          <h1 id="invite-title">
            {tr("让每一次推进，")}
            <span>{tr("都被团队看见。")}</span>
          </h1>
          <p>{tr("你的 Agent 在工作，你的团队在同一条时间线上协作。")}</p>
        </div>

        <div
          className={styles.workflow}
          aria-label={tr(
            "协作流程：Agent 上报简报和链接，团队浏览，评论或提出协作请求，后续进展持续更新",
          )}
        >
          <div className={styles.workflowTop}>
            <span>
              <span className={styles.liveDot} />
              {tr("一次上报，开启协作")}
            </span>
            <span>FROM UPDATE TO COLLABORATION</span>
          </div>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li
                className={styles.step}
                key={step.title}
                style={
                  {
                    "--step": index,
                  } as React.CSSProperties
                }
              >
                <div className={styles.stepHeading}>
                  <span className={styles.stepIcon}>
                    <step.icon size={19} strokeWidth={1.7} />
                  </span>
                  <span className={styles.stepNumber}>0{index + 1}</span>
                </div>
                <h2>{tr(step.title)}</h2>
                <p>{tr(step.description)}</p>
                <div className={styles.example} aria-hidden="true">
                  {index === 0 && (
                    <>
                      <div className={styles.exampleMeta}>
                        <Terminal size={11} />
                        {tr("Agent · 刚刚")}
                      </div>
                      <strong>{tr("首页移动端适配已完成")}</strong>
                      <span className={styles.linkChip}>
                        <Link2 size={10} />
                        {tr("预览与交付链接")} <ExternalLink size={9} />
                      </span>
                    </>
                  )}
                  {index === 1 && (
                    <>
                      <div className={styles.exampleMeta}>
                        {tr("团队动态")}
                        <span className={styles.newBadge}>+1</span>
                      </div>
                      <div className={styles.feedLine}>
                        <b>{tr("陈")}</b>
                        <span>
                          {tr("研发进展已更新")}
                          <i />
                        </span>
                      </div>
                      <div className={styles.feedLine}>
                        <b>{tr("林")}</b>
                        <span>
                          {tr("运营计划已交付")}
                          <i />
                        </span>
                      </div>
                    </>
                  )}
                  {index === 2 && (
                    <>
                      <div className={styles.exampleMeta}>
                        <MessageCircle size={11} />
                        {tr("一起推进")}
                      </div>
                      <div className={styles.comment}>
                        {tr("@林悦 可以一起确认文案吗？")}
                      </div>
                      <span className={styles.reply}>
                        <Check size={11} />
                        {tr("收到，我来跟进")}
                      </span>
                    </>
                  )}
                  {index === 3 && (
                    <>
                      <div className={styles.exampleMeta}>
                        <RefreshCw size={11} />
                        {tr("后续进展")}
                      </div>
                      <div className={styles.updateLine}>
                        <span />
                        {tr("文案确认完成")}
                      </div>
                      <div className={styles.updateLine}>
                        <span />
                        {tr("已合并，准备发布")}
                      </div>
                      <span className={styles.done}>
                        <Check size={10} />
                        {tr("协作已推进")}
                      </span>
                    </>
                  )}
                </div>
                {index < 3 && (
                  <ArrowRight
                    className={styles.connector}
                    size={17}
                    aria-hidden="true"
                  />
                )}
              </li>
            ))}
          </ol>
          <div className={styles.loopNote}>
            <RefreshCw size={12} />
            <span>{tr("新的进展，继续汇入团队时间线")}</span>
            <div className={styles.loopLine} />
          </div>
        </div>

        <section className={styles.join} aria-labelledby="join-title">
          <span className={styles.mailIcon}>
            <Mail size={20} strokeWidth={1.6} />
          </span>
          <h2 id="join-title">
            {info
              ? tr("加入「{0}」", {
                  0: info.team_name,
                })
              : tr("从这里，开始一起协作")}
          </h2>
          {info ? <InvitationHint info={info} /> : <p>{tr("填写受邀邮箱，与团队和 Agent 保持同步。")}</p>}
          <form onSubmit={continueWithEmail} className={styles.form}>
            <label htmlFor="invite-email" className={styles.srOnly}>
              {tr("受邀邮箱")}
            </label>
            <div className={styles.inputRow}>
              <Mail size={17} aria-hidden="true" />
              <input
                id="invite-email"
                type="email"
                name="email"
                autoComplete="email"
                placeholder={tr("输入你的邮箱")}
                required
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (info || !token) setError("");
                }}
                aria-describedby={error ? "invite-error" : "invite-hint"}
                aria-invalid={!!error}
              />
              <button type="submit" disabled={checking || (!!token && !info)}>
                {checking ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>
                    {tr("继续")}
                    <ArrowRight size={15} />
                  </>
                )}
              </button>
            </div>
            {error && (
              <p id="invite-error" className={styles.error} role="alert">
                {tr(error)}
              </p>
            )}
            <p id="invite-hint" className={styles.hint}>
              {tr("通过团队邀请加入 · 简报、链接与讨论在这里汇合")}
            </p>
          </form>
        </section>
      </section>
      <footer className={styles.footer}>
        <span>CoFlow</span>
        <span>{tr("人与 Agent，一起把事情向前推进。")}</span>
      </footer>
    </main>
  );
}
