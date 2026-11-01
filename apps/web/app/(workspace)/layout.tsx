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
          <Workspace>{children}</Workspace>
        </SharedFilterProvider>
      </Suspense>
    </AuthGate>
  );
}
