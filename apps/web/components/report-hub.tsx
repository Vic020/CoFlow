"use client";

import { useI18n } from "@/components/i18n-provider";
import { useState } from "react";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentAccess } from "@/components/agent-access";
import { ReportCompose } from "@/components/report-compose";
import { Meta } from "@/lib/types";
const methods = [
  ["manual", "手动上报"],
  ["agent", "Agent 上报"],
  ["skill", "Skill"],
  ["api", "API"],
  ["cli", "CLI"],
  ["mcp", "MCP"],
] as const;
export type ReportTab = (typeof methods)[number][0];
export function ReportHub({
  initialTab,
  meta,
  onClose,
  onReported,
}: {
  initialTab: ReportTab;
  meta: Meta;
  onClose: () => void;
  onReported: () => void;
}) {
  const { t: tr } = useI18n();
  const [tab, setTab] = useState<ReportTab>(initialTab);
  return (
    <>
      <DialogTitle className="modal-title">{tr("上报进展")}</DialogTitle>
      <DialogDescription className="sr-only">
        {tr("选择手动填写或通过 Agent、Skill、API 上报。CLI 与 MCP 未来支持。")}
      </DialogDescription>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ReportTab)}
        className="report-hub-tabs"
      >
        <TabsList aria-label={tr("上报方式")}>
          {methods.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {tr(label)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="manual">
          <ReportCompose meta={meta} onDone={onReported} />
        </TabsContent>
        {methods.map(([value]) =>
          value === "manual" ? null : (
            <TabsContent value={value} key={value}>
              {tab === value && (
                <AgentAccess
                  method={value}
                  meta={meta}
                  onSelect={setTab}
                  onClose={onClose}
                />
              )}
            </TabsContent>
          ),
        )}
      </Tabs>
    </>
  );
}
