import { Workspace } from "@/components/workspace";
import { AuthGate } from "@/components/auth-gate";
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <Workspace>{children}</Workspace>
    </AuthGate>
  );
}
