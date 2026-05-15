export function toTitleCaseName(value: string | null | undefined): string {
  const input = String(value || "").trim();
  if (!input) return "";

  return input
    .split(/\s+/)
    .map((word) =>
      word
        .split("-")
        .map((part) => {
          if (!part) return part;
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join("-"),
    )
    .join(" ");
}

