"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small action lists close on outside pointer/focus, selection and Escape. */
export function ActionMenu({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const items = () =>
    Array.from(
      panel.current?.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
        "button:not(:disabled),a[href]",
      ) || [],
    );
  function focusFirst() {
    requestAnimationFrame(() => items()[0]?.focus());
  }
  return (
    <div
      className={cn("action-menu", className)}
      ref={root}
      onBlur={(e) => {
        if (
          e.relatedTarget &&
          !e.currentTarget.contains(e.relatedTarget as Node)
        )
          setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
          return;
        }
        if (
          !open ||
          !(e.target instanceof HTMLElement) ||
          !panel.current?.contains(e.target)
        )
          return;
        const list = items(),
          i = list.indexOf(e.target as HTMLButtonElement);
        let next = -1;
        if (e.key === "ArrowDown") next = (i + 1) % list.length;
        else if (e.key === "ArrowUp")
          next = (i - 1 + list.length) % list.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = list.length - 1;
        if (next >= 0 && list.length) {
          e.preventDefault();
          list[next].focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="action-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            focusFirst();
          }
        }}
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="menu"
          aria-label={label}
          className="action-menu-panel"
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("button:not(:disabled),a[href]")) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
