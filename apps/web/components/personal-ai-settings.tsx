"use client";

import { useState } from "react";
import { useI18n } from "./i18n-provider";
import { useAuth } from "./auth-gate";
import { AssistantApprovals } from "./assistant-approvals";
import { AssistantBehavior } from "./assistant-behavior";
import { AISettings } from "./assistant-settings";
import { WebSettings } from "./web-settings";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";

export function PersonalAISettings({
  initialTab = "ai",
  onClose,
}: {
  initialTab?: "ai" | "web";
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { me, mode } = useAuth();
  const [tab, setTab] = useState<string>(initialTab);
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="personal-ai-dialog info-dialog">
        <DialogTitle className="modal-title">{t("个人 AI 设定")}</DialogTitle>
        <DialogDescription className="muted">
          {t(tab === "approvals" ? "仅自己可用，适用于当前空间。" : "仅自己可用，适用于所有空间。")}
        </DialogDescription>
        <Tabs value={tab} onValueChange={setTab} className="personal-ai-tabs">
          <TabsList aria-label={t("个人 AI 设定")}>
            <TabsTrigger value="ai">{t("模型服务")}</TabsTrigger>
            <TabsTrigger value="web">{t("联网服务")}</TabsTrigger>
            <TabsTrigger value="behavior">{t("助手行为")}</TabsTrigger>
            {mode === "team" && <TabsTrigger value="approvals">{t("动作授权")}</TabsTrigger>}
          </TabsList>
          <TabsContent value="ai">
            <AISettings scope="personal" />
          </TabsContent>
          <TabsContent value="behavior">
            <AssistantBehavior />
          </TabsContent>
          {mode === "team" && <TabsContent value="approvals"><AssistantApprovals key={me?.current_team} /></TabsContent>}
          <TabsContent value="web">
            <WebSettings scope="personal" />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
