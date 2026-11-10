"use client";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n-provider";

/** Portaled so feedback cannot widen or be clipped by a scrolling directory. */
export function ActionFeedback({
  anchor,
  message,
  onView,
  onClose,
  onEnter,
  onLeave,
}: {
  anchor: RefObject<HTMLSpanElement | null>;
  message: string;
  onView: () => void;
  onClose: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 264 });
  useLayoutEffect(() => {
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(264, window.innerWidth - 16);
      const height = box.current?.getBoundingClientRect().height || 60;
      setPosition({
        width,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: Math.max(
          8,
          rect.bottom + height + 6 <= window.innerHeight - 8
            ? rect.bottom + 6
            : rect.top - height - 6,
        ),
      });
    };
    const outside = (e: PointerEvent) => {
      if (
        !anchor.current?.contains(e.target as Node) &&
        !box.current?.contains(e.target as Node)
      )
        onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    update();
    const observer = new ResizeObserver(update);
    if (anchor.current) observer.observe(anchor.current);
    if (box.current) observer.observe(box.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [anchor, message, onClose]);
  return createPortal(
    <div
      ref={box}
      role="group"
      aria-label={t("AI 任务状态")}
      className="action-feedback"
      style={position}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={(e) => e.stopPropagation()}
    >
      <p>{message}</p>
      <button type="button" onClick={onView}>
        {t("查看任务")}
      </button>
    </div>,
    document.body,
  );
}
