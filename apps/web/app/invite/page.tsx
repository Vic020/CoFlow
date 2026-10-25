import type { Metadata } from "next";
import { DemoInvite } from "@/components/demo-invite";
import { publicDemo } from "@/lib/runtime";
import { InviteWelcome } from "@/components/invite-welcome";

export const metadata: Metadata = {
  description: "Agent reports, team review, discussion, and follow-up.",
};

export default function InvitePage() {
  if (publicDemo) return <DemoInvite />;
  return <InviteWelcome />;
}
