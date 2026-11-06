import { AssistantProvider } from "@/components/assistant-provider";
import { Workspace } from "@/components/workspace";
import { AuthGate } from "@/components/auth-gate";
import { Suspense } from "react";
import { SharedFilterProvider } from "@/components/shared-filters";
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <SharedFilterProvider>
          <AssistantProvider>
            <Workspace>{children}</Workspace>
          </AssistantProvider>
        </SharedFilterProvider>
      </Suspense>
    </AuthGate>
  );
}
