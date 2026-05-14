import { useEffect } from "react";

export function useRevealOnScroll(): void {
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    if (window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    const handleLoad = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };
    window.addEventListener("load", handleLoad, { once: true });

    if (nodes.length === 0) {
      return () => {
        window.removeEventListener("load", handleLoad);
      };
    }

    const reduced = window.matchMedia("(prefers-reduced-motion:reduce)").matches;
    if (reduced) {
      nodes.forEach((node) => node.classList.add("in"));
      return;
    }

    nodes.forEach((node) => node.classList.add("is-pending"));

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    nodes.forEach((node) => obs.observe(node));
    return () => {
      window.removeEventListener("load", handleLoad);
      obs.disconnect();
    };
  }, []);
}
