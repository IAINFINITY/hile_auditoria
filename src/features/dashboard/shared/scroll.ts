export function preserveWindowScroll(update: () => void): void {
  if (typeof window === "undefined") {
    update();
    return;
  }

  const top = window.scrollY || document.documentElement.scrollTop || 0;
  update();

  const restore = () => {
    window.scrollTo({ top, left: 0, behavior: "auto" });
  };

  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(restore);
  });
}
