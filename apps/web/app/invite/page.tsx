import type { Metadata } from "next";
import Link from "next/link";
import { publicDemo } from "@/lib/runtime";
import { InviteWelcome } from "@/components/invite-welcome";

export const metadata: Metadata = {
  title: "加入协作 · CoFlow",
  description: "Agent 上报简报和链接，团队浏览、评论协作，后续进展持续更新。",
};

export default function InvitePage() {
  if (publicDemo) return <main className="account-page"><section className="account-card"><h1>公开演示</h1><p>此站点不接收邀请或账号信息。请在自己的 CoFlow 实例中加入团队。</p><Link href="/">返回演示团队</Link></section></main>;
  return <InviteWelcome />;
}
