import { useCallback, useEffect, useRef, useState } from "react";

type UseChartEnterAnimationOptions = {
  durationMs?: number;
  delayMs?: number;
  threshold?: number;
  rootMargin?: string;
  triggerAt?: number;
  settleMs?: number;
  armDelayMs?: number;
};

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function useChartEnterAnimation<T extends HTMLElement | SVGElement = HTMLElement>(
  options: UseChartEnterAnimationOptions = {},
) {
  const { durationMs = 980, delayMs = 0, triggerAt = 0.55, settleMs = 180, armDelayMs = 700 } = options;
  const [node, setNode] = useState<T | null>(null);
  const frameRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const armTimeoutRef = useRef<number | null>(null);
  const isArmedRef = useRef(false);
  const hasStartedRef = useRef(false);
  const [progress, setProgress] = useState(0);

  const rootRef = useCallback((element: T | null) => {
    setNode(element);
  }, []);

  useEffect(() => {
    if (!node) return;
    isArmedRef.current = false;

    const isInsideActiveViewportBand = () => {
      const rect = node.getBoundingClientRect();
      const viewportH = window.innerHeight || document.documentElement.clientHeight || 1;
      const triggerLine = viewportH * clamp(triggerAt);
      const referenceY = rect.top + rect.height * 0.35;
      return referenceY <= triggerLine && rect.bottom >= viewportH * 0.14;
    };

    const runAnimation = () => {
      const startedAt = performance.now();
      const step = (now: number) => {
        const linear = Math.min(1, (now - startedAt) / Math.max(1, durationMs));
        setProgress(easeOutCubic(linear));
        if (linear < 1) {
          frameRef.current = requestAnimationFrame(step);
        } else {
          frameRef.current = null;
        }
      };
      frameRef.current = requestAnimationFrame(step);
    };

    const start = () => {
      if (hasStartedRef.current) return;
      hasStartedRef.current = true;
      const safeDelay = Math.max(delayMs, settleMs);
      if (safeDelay > 0) timeoutRef.current = window.setTimeout(runAnimation, safeDelay);
      else runAnimation();
    };

    const checkAndStart = () => {
      frameRef.current = null;
      if (hasStartedRef.current) return;
      if (isInsideActiveViewportBand()) start();
    };

    const scheduleCheck = () => {
      if (!isArmedRef.current) return;
      if (hasStartedRef.current) return;
      if (frameRef.current != null) return;
      frameRef.current = requestAnimationFrame(checkAndStart);
    };

    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (!isArmedRef.current || hasStartedRef.current) return;
              if (entries.some((entry) => entry.isIntersecting)) start();
            },
            {
              threshold: 0.01,
              rootMargin: "0px 0px -4% 0px",
            },
          );
    observer?.observe(node);

    armTimeoutRef.current = window.setTimeout(() => {
      isArmedRef.current = true;
      scheduleCheck();
    }, armDelayMs);
    window.addEventListener("scroll", scheduleCheck, { passive: true });
    window.addEventListener("resize", scheduleCheck);

    return () => {
      isArmedRef.current = false;
      if (armTimeoutRef.current != null) window.clearTimeout(armTimeoutRef.current);
      window.removeEventListener("scroll", scheduleCheck);
      window.removeEventListener("resize", scheduleCheck);
      observer?.disconnect();
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    };
  }, [armDelayMs, delayMs, durationMs, node, settleMs, triggerAt]);

  return { rootRef, progress };
}
