"use client";
import { createContext, useContext, useId } from "react";
import { cn } from "@/lib/utils";

const TabsContext = createContext<{
  id: string;
  value: string;
  change: (value: string) => void;
} | null>(null);
function useTabs() {
  const tabs = useContext(TabsContext);
  if (!tabs) throw new Error("Tabs is required");
  return tabs;
}
export function Tabs({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <TabsContext.Provider value={{ id, value, change: onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}
export function TabsList({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      {...props}
      role="tablist"
      className={cn("ui-tabs-list", className)}
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        const tabs = Array.from(
          e.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="tab"]:not(:disabled)',
          ),
        );
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        e.preventDefault();
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                tabs.length;
        tabs[next]?.focus();
        tabs[next]?.click();
      }}
    >
      {children}
    </div>
  );
}
export function TabsTrigger({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  const tabs = useTabs();
  const active = tabs.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${tabs.id}-tab-${value}`}
      aria-controls={`${tabs.id}-panel-${value}`}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={() => tabs.change(value)}
    >
      {children}
    </button>
  );
}
export function TabsContent({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  const tabs = useTabs();
  return (
    <div
      role="tabpanel"
      id={`${tabs.id}-panel-${value}`}
      aria-labelledby={`${tabs.id}-tab-${value}`}
      hidden={tabs.value !== value}
      className="ui-tabs-panel"
    >
      {children}
    </div>
  );
}
