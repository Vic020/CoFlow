import type { Metadata } from "next";
import { InviteWelcome } from "@/components/invite-welcome";

export const metadata: Metadata = {
  title: "加入协作 · CoFlow",
  description: "Agent 上报简报和链接，团队浏览、评论协作，后续进展持续更新。",
};

export default function InvitePage() {
  return <InviteWelcome />;
}
