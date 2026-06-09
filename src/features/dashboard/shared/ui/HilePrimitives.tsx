import type { KeyboardEvent, ReactNode } from "react";

type CardTone = "default" | "soft" | "accent" | "critical";
type KpiTone = "default" | "accent" | "critical" | "success";
type KpiAccent = "default" | "accent" | "critical" | "high" | "success";
type InsightTone = "default" | "warning" | "critical";

function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function HileSectionShell({
  eyebrow,
  title,
  description,
  action,
  children,
  muted = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <section className="hile-section-shell" data-muted={muted ? "true" : undefined}>
      <header className="hile-section-shell-header">
        <div className="hile-section-shell-title">
          {eyebrow ? <span className="hile-section-shell-eyebrow">{eyebrow}</span> : null}
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </header>
      <div className="hile-section-shell-body">{children}</div>
    </section>
  );
}

export function HileCardGrid({
  cols = 3,
  children,
}: {
  cols?: 2 | 3 | 4;
  children: ReactNode;
}) {
  return (
    <div className="hile-card-grid" data-cols={String(cols)}>
      {children}
    </div>
  );
}

export function HileSurfaceCard({
  title,
  description,
  children,
  tone = "default",
  interactive = false,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  tone?: CardTone;
  interactive?: boolean;
  className?: string;
}) {
  return (
    <article
      className={joinClasses("hile-surface-card", className)}
      data-tone={tone === "default" ? undefined : tone}
      data-interactive={interactive ? "true" : undefined}
    >
      {title || description ? (
        <div className="hile-surface-card-head">
          {title ? <h4>{title}</h4> : null}
          {description ? <p>{description}</p> : null}
        </div>
      ) : null}
      <div className="hile-surface-card-body">{children}</div>
    </article>
  );
}

export function HileKpiCard({
  label,
  value,
  hint,
  tone = "default",
  accent = "default",
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: KpiTone;
  accent?: KpiAccent;
  onClick?: () => void;
}) {
  const interactiveProps = onClick
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick,
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Enter" || event.key === " ") onClick();
        },
      }
    : {};

  return (
    <div
      className="hile-kpi-card"
      data-tone={tone === "default" ? undefined : tone}
      data-interactive={onClick ? "true" : undefined}
      {...interactiveProps}
    >
      <span className="hile-kpi-label">{label}</span>
      <strong className="hile-kpi-value" data-accent={accent === "default" ? undefined : accent}>
        {value}
      </strong>
      {hint ? <span className="hile-kpi-hint">{hint}</span> : null}
    </div>
  );
}

export function HilePillRow({ children }: { children: ReactNode }) {
  return <div className="hile-pill-row">{children}</div>;
}

export function HilePill({
  active = false,
  tone = "default",
  children,
}: {
  active?: boolean;
  tone?: "default" | "ghost";
  children: ReactNode;
}) {
  return (
    <span className="hile-pill" data-active={active ? "true" : undefined} data-tone={tone === "default" ? undefined : tone}>
      {children}
    </span>
  );
}

export function HileEmptyPanel({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="hile-empty-panel">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

export function HileInlineInsight({
  title,
  children,
  tone = "default",
}: {
  title: string;
  children: ReactNode;
  tone?: InsightTone;
}) {
  return (
    <div className="hile-inline-insight" data-tone={tone === "default" ? undefined : tone}>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
