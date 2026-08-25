"use client";

import { useEffect, useState } from "react";

export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function useListNavigation(itemCount: number) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex((current) => {
      if (itemCount <= 0) {
        return 0;
      }
      return Math.min(current, itemCount - 1);
    });
  }, [itemCount]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) {
        if (event.key === "Escape") {
          (event.target as HTMLElement).blur();
        }
        return;
      }
      if (itemCount <= 0) {
        return;
      }
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((current) => Math.min(itemCount - 1, current + 1));
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [itemCount]);

  useEffect(() => {
    const selected = document.querySelector(`[data-nav-index="${index}"]`);
    if (selected instanceof HTMLElement) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [index]);

  return index;
}
