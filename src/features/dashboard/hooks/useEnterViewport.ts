import { useCallback, useEffect, useState } from "react";

type UseEnterViewportOptions = {
  threshold?: number;
  rootMargin?: string;
  triggerAt?: number;
  armDelayMs?: number;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function useEnterViewport<T extends HTMLElement = HTMLElement>(
  options: UseEnterViewportOptions = {},
) {
  const { triggerAt = 0.72, armDelayMs = 700 } = options;
  const [node, setNode] = useState<T | null>(null);
  const [hasEntered, setHasEntered] = useState(false);

  const rootRef = useCallback((element: T | null) => {
    setNode(element);
  }, []);

  useEffect(() => {
    if (!node || hasEntered) return;
    const markEntered = () => queueMicrotask(() => setHasEntered(true));
    let isArmed = false;

    const isInsideActiveViewportBand = () => {
      const rect = node.getBoundingClientRect();
      const viewportH = window.innerHeight || document.documentElement.clientHeight || 1;
      const triggerLine = viewportH * clamp(triggerAt);
      return rect.top <= triggerLine && rect.bottom >= viewportH * 0.08;
    };

    let frame: number | null = null;
    const checkAndEnter = () => {
      frame = null;
      if (isInsideActiveViewportBand()) markEntered();
    };

    const scheduleCheck = () => {
      if (!isArmed) return;
      if (frame != null) return;
      frame = requestAnimationFrame(checkAndEnter);
    };

    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (!isArmed) return;
              if (entries.some((entry) => entry.isIntersecting)) markEntered();
            },
            {
              threshold: 0.01,
              rootMargin: "0px 0px -4% 0px",
            },
          );
    observer?.observe(node);

    const armTimeout = window.setTimeout(() => {
      isArmed = true;
      scheduleCheck();
    }, armDelayMs);
    window.addEventListener("scroll", scheduleCheck, { passive: true });
    window.addEventListener("resize", scheduleCheck);

    return () => {
      window.clearTimeout(armTimeout);
      window.removeEventListener("scroll", scheduleCheck);
      window.removeEventListener("resize", scheduleCheck);
      observer?.disconnect();
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [armDelayMs, hasEntered, node, triggerAt]);

  return { rootRef, hasEntered };
}
