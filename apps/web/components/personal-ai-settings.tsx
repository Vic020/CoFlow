"use client";

import { useState } from "react";
import { useI18n } from "./i18n-provider";
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
          {t("仅自己可用，适用于所有空间。")}
        </DialogDescription>
        <Tabs value={tab} onValueChange={setTab} className="personal-ai-tabs">
          <TabsList aria-label={t("个人 AI 设定")}>
            <TabsTrigger value="ai">{t("模型服务")}</TabsTrigger>
            <TabsTrigger value="web">{t("联网服务")}</TabsTrigger>
          </TabsList>
          <TabsContent value="ai">
            <AISettings scope="personal" />
          </TabsContent>
          <TabsContent value="web">
            <WebSettings scope="personal" />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
