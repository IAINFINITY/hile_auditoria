"use client";

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDashboardController } from "@/features/dashboard/hooks/useDashboardController";
import { useNotifications } from "@/features/dashboard/hooks/useNotifications";
import { useRevealOnScroll } from "@/features/dashboard/hooks/useRevealOnScroll";
import { AppFooter } from "@/features/dashboard/sections/layout/AppFooter";
import { ShellNavigation } from "@/features/dashboard/sections/layout/ShellNavigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { VIEW_SECTION_KEYS } from "./constants";
import { AppModals } from "./components/AppModals";
import { LoginScreen } from "./components/LoginScreen";
import { MainContentRenderer } from "./components/MainContentRenderer";
import { SplashScreen } from "./components/SplashScreen";
import type { AppView, AuthStatusPayload } from "./types";
import type { OwnerScope } from "@/features/dashboard/shared/types";

function normalizeEmail(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function activityStorageKey(emailValue: string | null | undefined): string {
  const normalized = normalizeEmail(emailValue);
  return normalized ? `hile_last_activity:${normalized}` : "hile_last_activity";
}

function readLastActivity(emailValue: string | null | undefined): number | null {
  try {
    const raw = localStorage.getItem(activityStorageKey(emailValue));
    if (!raw) return null;
    const timestamp = Number(raw);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    return timestamp;
  } catch {
    return null;
  }
}

function writeLastActivity(emailValue: string | null | undefined, timestamp = Date.now()): void {
  try {
    localStorage.setItem(activityStorageKey(emailValue), String(timestamp));
  } catch {
    // noop
  }
}

function clearLastActivity(emailValue: string | null | undefined): void {
  try {
    localStorage.removeItem(activityStorageKey(emailValue));
  } catch {
    // noop
  }
}

function summarizeRunFailureMessage(message: string): string {
  const cleaned = String(message || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  const technicalMarker = "Mantivemos os dados anteriores:";
  if (cleaned.includes(technicalMarker)) {
    const [prefix] = cleaned.split(technicalMarker);
    const base = prefix.trim().replace(/\s+\.$/, ".").replace(/\.$/, "");
    return base ? `${base}.` : "A execução falhou.";
  }

  const maxLength = 220;
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

export function DashboardApp() {
  const clearStaleAuthStorage = useCallback(() => {
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith("sb-") || key.includes("supabase")) {
          localStorage.removeItem(key);
        }
      }
      for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
        const key = sessionStorage.key(i);
        if (!key) continue;
        if (key.startsWith("sb-") || key.includes("supabase")) {
          sessionStorage.removeItem(key);
        }
      }
    } catch {
      // noop
    }
  }, []);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [activeView, setActiveView] = useState<AppView>(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem("hile_active_view");
      if (
        saved === "dashboard" ||
        saved === "clients" ||
        saved === "analysis" ||
        saved === "attendants" ||
        saved === "dissatisfaction" ||
        saved === "products" ||
        saved === "logs" ||
        saved === "superadmin" ||
        saved === "settings"
      ) {
        return saved;
      }
    }
    return "dashboard";
  });
  const [stage, setStage] = useState<"boot" | "splash" | "login" | "app">("boot");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem("hile_remember") !== "false";
    } catch {
      return true;
    }
  });
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [showLogoutConfirmModal, setShowLogoutConfirmModal] = useState(false);
  const [dismissedRunWarningId, setDismissedRunWarningId] = useState<string | null>(null);
  const [dismissedRunFailureStatus, setDismissedRunFailureStatus] = useState("");
  const [runFailureMessage, setRunFailureMessage] = useState("");
  const [activeSubNavKey, setActiveSubNavKey] = useState<string>("inicio");
  const navSyncFreezeUntilRef = useRef(0);
  const pendingAnchoredNavigationRef = useRef<{ view: Exclude<AppView, "dashboard">; section: string } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("hile_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [analysisScope, setAnalysisScope] = useState<"day" | "overall">("day");
  const [dissatisfactionScope, setDissatisfactionScope] = useState<"day" | "overall">("day");
  const [ownerScope, setOwnerScope] = useState<OwnerScope>(() => {
    if (typeof window === "undefined") return "all";
    try {
      const saved = sessionStorage.getItem("hile_owner_scope");
      if (saved === "ia" || saved === "suellen" || saved === "samuel" || saved === "all") return saved;
    } catch {
      // noop
    }
    return "all";
  });
  const [currentUser, setCurrentUser] = useState<{ name: string; email: string; role: string } | null>(null);
  const isSuperadmin = String(currentUser?.role || "")
    .trim()
    .toLowerCase()
    .includes("superadmin");
  const effectiveActiveView: AppView = activeView === "superadmin" && !isSuperadmin ? "settings" : activeView;

  useRevealOnScroll({ enabled: stage === "app", viewKey: effectiveActiveView });

  useEffect(() => {
    const pending = pendingAnchoredNavigationRef.current;
    if (!pending) return;
    if (effectiveActiveView !== pending.view) return;

    const section = pending.section;
    let cancelled = false;
    let firstRaf = 0;
    let secondRaf = 0;

    firstRaf = requestAnimationFrame(() => {
      secondRaf = requestAnimationFrame(() => {
        if (cancelled) return;
        pendingAnchoredNavigationRef.current = null;
        scrollToAnchoredSection(section);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(firstRaf);
      cancelAnimationFrame(secondRaf);
    };
  }, [effectiveActiveView]);

  const controller = useDashboardController({
    enabled: stage === "app",
    syncNavOnScroll: stage === "app" && effectiveActiveView === "dashboard",
  });
  const notifyPrefs = useMemo(() => {
    const userKey = normalizeEmail(currentUser?.email || "");
    const reportScopedKey = userKey ? `hile_settings_notify_report:${userKey}` : null;
    const logScopedKey = userKey ? `hile_settings_notify_log:${userKey}` : null;
    const clientScopedKey = userKey ? `hile_settings_notify_client:${userKey}` : null;
    const loadScoped = (scopedKey: string | null, legacyKey: string, fallback = true) => {
      try {
        if (scopedKey) {
          const scoped = localStorage.getItem(scopedKey);
          if (scoped !== null) return scoped === "true";
        }
        const legacy = localStorage.getItem(legacyKey);
        return legacy === null ? fallback : legacy === "true";
      } catch {
        return fallback;
      }
    };
    try {
      return {
        report: loadScoped(reportScopedKey, "hile_settings_notify_report", true),
        log: loadScoped(logScopedKey, "hile_settings_notify_log", true),
        client: loadScoped(clientScopedKey, "hile_settings_notify_client", true),
      };
    } catch {
      return { report: true, log: true, client: true };
    }
  }, [currentUser?.email]);

  const { state: notificationState, clear: clearNotifications, clearOne: clearNotification } = useNotifications({
    enabled: stage === "app" && !controller.isRunningOverview,
    notifyReport: notifyPrefs.report,
    notifyLog: notifyPrefs.log,
    notifyClient: notifyPrefs.client,
    currentDate: controller.date,
    runCompletedCount: controller.overviewRunCount,
    isRunningOverview: controller.isRunningOverview,
  });

  const clientsSnapshotDate = useMemo(() => controller.reportHistory[0]?.date_ref || controller.date, [controller.date, controller.reportHistory]);

  const forceScrollTop = useCallback(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  const selectedDateKnownRunId = useMemo(() => {
    let bestRun: { id: string; started_at: string } | null = null;
    for (const run of controller.reportHistory) {
      if (run.date_ref !== clientsSnapshotDate || !run.has_report) continue;
      if (!bestRun || new Date(run.started_at).getTime() > new Date(bestRun.started_at).getTime()) {
        bestRun = { id: run.id, started_at: run.started_at };
      }
    }
    return bestRun?.id || null;
  }, [clientsSnapshotDate, controller.reportHistory]);

  const runStatusText = String(controller.status || "").trim();
  const normalizedRunStatus = runStatusText.toLowerCase();
  const runFailureSummary = summarizeRunFailureMessage(runFailureMessage || runStatusText);
  const isRunFailure =
    !controller.isRunningOverview &&
    (normalizedRunStatus.startsWith("erro:") ||
      normalizedRunStatus.includes("relatório falhou") ||
      normalizedRunStatus.includes("relatorio falhou") ||
      normalizedRunStatus.includes("falhou"));
  const shouldShowRunWarningModal = controller.isRunningOverview && dismissedRunWarningId !== controller.currentRunId;
  const shouldShowRunFailureModal = isRunFailure && dismissedRunFailureStatus !== runStatusText;

  const sessionIdleTimeoutMs = useMemo(() => {
    const minutes = Number(process.env.NEXT_PUBLIC_SESSION_TIMEOUT_MINUTES || 30);
    if (!Number.isFinite(minutes) || minutes <= 0) return 30 * 60 * 1000;
    return minutes * 60 * 1000;
  }, []);

  function toPrettyName(emailValue: string | null | undefined): string {
    const safeEmail = String(emailValue || "").trim().toLowerCase();
    const nameFromEmail = safeEmail.split("@")[0] || "Usuário";
    return nameFromEmail
      .split(".")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function toPrettyRole(role: "superadmin" | "admin" | null | undefined): string {
    if (role === "superadmin") return "Superadmin";
    if (role === "admin") return "Admin";
    return "Admin";
  }

  const fetchAuthStatus = useCallback(async (): Promise<AuthStatusPayload | null> => {
    try {
      const response = await fetch("/api/auth/status", { method: "GET", cache: "no-store" });
      if (!response.ok) return null;
      return (await response.json()) as AuthStatusPayload;
    } catch {
      return null;
    }
  }, []);

  const fetchAuthStatusWithRetry = useCallback(
    async (attempts = 6, delayMs = 250): Promise<AuthStatusPayload | null> => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const status = await fetchAuthStatus();
        if (status?.authenticated && status?.authorized && status.user) return status;
        if (attempt < attempts - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
      }
      return null;
    },
    [fetchAuthStatus],
  );

  useEffect(() => {
    try {
      localStorage.setItem("hile_remember", rememberMe ? "true" : "false");
    } catch {
      // noop
    }
  }, [rememberMe]);

  useEffect(() => {
    let cancelled = false;
    let splashTimer: number | null = null;
    const shouldShowSplash = window.sessionStorage.getItem("hile_splash_seen") !== "1";
    if (shouldShowSplash) {
      window.sessionStorage.setItem("hile_splash_seen", "1");
      splashTimer = window.setTimeout(() => {
        if (!cancelled) setStage("splash");
      }, 0);
    }
    const delayMs = shouldShowSplash ? 2300 : 0;
    const timer = window.setTimeout(() => {
      void (async () => {
        const { data, error } = await supabaseBrowser.auth.getSession();
        if (error) {
          const normalized = String(error.message || "").toLowerCase();
          if (normalized.includes("refresh token")) {
            clearStaleAuthStorage();
            try {
              await supabaseBrowser.auth.signOut({ scope: "local" });
            } catch {
              // noop
            }
          }
          if (!cancelled) setStage("login");
          return;
        }

        const session = data?.session ?? null;
        const persistSession = localStorage.getItem("hile_remember") === "true";
        const tabSession = sessionStorage.getItem("hile_tab_session") === "true";

        if (session && !persistSession && !tabSession) {
          await supabaseBrowser.auth.signOut();
          if (!cancelled) setStage("login");
          return;
        }
        if (!session) {
          if (!cancelled) setStage("login");
          return;
        }

        const status = await fetchAuthStatusWithRetry();
        if (!status?.authenticated || !status?.authorized || !status.user) {
          await supabaseBrowser.auth.signOut();
          if (!cancelled) {
            setLoginError("Não foi possível validar seu acesso. Faça login novamente.");
            setStage("login");
          }
          return;
        }

        const lastActivityAt = readLastActivity(status.user.email);
        if (lastActivityAt && Date.now() - lastActivityAt > sessionIdleTimeoutMs) {
          clearLastActivity(status.user.email);
          try {
            await supabaseBrowser.auth.signOut();
          } catch {
            // noop
          }
          if (!cancelled) {
            setLoginError("Sessão encerrada por inatividade. Entre novamente para continuar.");
            setStage("login");
          }
          return;
        }

        if (!cancelled) {
          const meta = session.user?.user_metadata || {};
          writeLastActivity(status.user.email);
          setCurrentUser({
            name: meta.name || toPrettyName(status.user.email),
            email: status.user.email || "usuario@hile.com.br",
            role: toPrettyRole(status.user.role),
          });
          setStage("app");
        }
      })();
    }, delayMs);

    return () => {
      cancelled = true;
      if (splashTimer) window.clearTimeout(splashTimer);
      window.clearTimeout(timer);
    };
  }, [clearStaleAuthStorage, fetchAuthStatusWithRetry, sessionIdleTimeoutMs]);

  useEffect(() => {
    try {
      sessionStorage.setItem("hile_active_view", effectiveActiveView);
    } catch {
      // noop
    }
  }, [effectiveActiveView]);

  useEffect(() => {
    try {
      sessionStorage.setItem("hile_owner_scope", ownerScope);
    } catch {
      // noop
    }
  }, [ownerScope]);

  useEffect(() => {
    try {
      localStorage.setItem("hile_sidebar_collapsed", sidebarCollapsed ? "true" : "false");
    } catch {
      // noop
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const nextKey =
      effectiveActiveView === "dashboard"
        ? "inicio"
        : effectiveActiveView === "clients"
          ? "clients-filtros"
          : effectiveActiveView === "analysis"
            ? "analysis-overview"
            : effectiveActiveView === "attendants"
              ? "attendants-overview"
              : effectiveActiveView === "dissatisfaction"
                ? "dissatisfaction-overview"
                : effectiveActiveView === "products"
                  ? "products-overview"
                  : effectiveActiveView === "logs"
                    ? "logs-saude"
                    : effectiveActiveView === "superadmin"
                      ? "superadmin-accounts"
                    : "settings-profile";

    const raf = requestAnimationFrame(() => setActiveSubNavKey(nextKey));
    return () => cancelAnimationFrame(raf);
  }, [effectiveActiveView]);

  useEffect(() => {
    if (stage !== "app" || effectiveActiveView === "dashboard") return;
    const sectionKeys = VIEW_SECTION_KEYS[effectiveActiveView];
    if (!sectionKeys || sectionKeys.length === 0) return;

    const syncActiveSection = () => {
      if (Date.now() < navSyncFreezeUntilRef.current) return;

      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop || 0;
      const viewportBottom = scrollTop + window.innerHeight;
      const pageBottom = doc.scrollHeight - 2;

      if (viewportBottom >= pageBottom) {
        const lastKey = sectionKeys[sectionKeys.length - 1];
        setActiveSubNavKey((current) => (current === lastKey ? current : lastKey));
        return;
      }

      const marker = 96;
      let bestKey = sectionKeys[0];
      let bestTopDistance = Number.POSITIVE_INFINITY;

      for (const key of sectionKeys) {
        const element = document.getElementById(key);
        if (!element) continue;
        const top = element.getBoundingClientRect().top;
        const distance = Math.abs(top - marker);
        if (top <= marker && distance < bestTopDistance) {
          bestTopDistance = distance;
          bestKey = key;
        }
      }

      if (bestTopDistance === Number.POSITIVE_INFINITY) {
        for (const key of sectionKeys) {
          if (document.getElementById(key)) {
            bestKey = key;
            break;
          }
        }
      }

      setActiveSubNavKey((current) => (current === bestKey ? current : bestKey));
    };

    let raf = requestAnimationFrame(syncActiveSection);
    const handleScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncActiveSection);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [effectiveActiveView, stage]);

  useLayoutEffect(() => {
    if (stage !== "app") return;
    forceScrollTop();
    requestAnimationFrame(() => {
      forceScrollTop();
      requestAnimationFrame(forceScrollTop);
    });
  }, [effectiveActiveView, forceScrollTop, stage]);

  useEffect(() => {
    if (stage !== "app" || !controller.isRunningOverview) {
      window.onbeforeunload = null;
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };
    window.onbeforeunload = handler;
    window.addEventListener("beforeunload", handler);
    return () => {
      window.onbeforeunload = null;
      window.removeEventListener("beforeunload", handler);
    };
  }, [controller.isRunningOverview, stage]);

  useEffect(() => {
    if (stage !== "app") return;
    let timer: number | null = null;
    let didLogout = false;
    const currentEmail = currentUser?.email || null;

    const forceLogoutByInactivity = async () => {
      if (didLogout) return;
      didLogout = true;
      clearLastActivity(currentEmail);
      await supabaseBrowser.auth.signOut();
      setCurrentUser(null);
      setStage("login");
      setPassword("");
      setShowPassword(false);
      setIsAuthenticating(false);
      setShowForgotPasswordModal(false);
      setShowConfirmModal(false);
      setShowLogoutConfirmModal(false);
      setActiveView("dashboard");
      setLoginError("Sessão encerrada por inatividade. Entre novamente para continuar.");
    };

    const resetIdleTimer = () => {
      writeLastActivity(currentEmail);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void forceLogoutByInactivity(), sessionIdleTimeoutMs);
    };

    const events: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    for (const eventName of events) window.addEventListener(eventName, resetIdleTimer, { passive: true });
    resetIdleTimer();

    return () => {
      if (timer) window.clearTimeout(timer);
      for (const eventName of events) window.removeEventListener(eventName, resetIdleTimer);
    };
  }, [currentUser?.email, sessionIdleTimeoutMs, stage]);

  function scrollToAnchoredSection(sectionId: string) {
    const target = document.getElementById(sectionId);
    if (!target) return;
    navSyncFreezeUntilRef.current = Date.now() + 850;
    setActiveSubNavKey(sectionId);
    const top = Math.max(0, target.offsetTop - 68);
    window.scrollTo({ top, behavior: "smooth" });
  }

  function openViewAndScrollTop(view: AppView, subNavKey?: string) {
    pendingAnchoredNavigationRef.current = null;
    if (subNavKey) setActiveSubNavKey(subNavKey);
    forceScrollTop();
    setActiveView(view);
    requestAnimationFrame(() => {
      forceScrollTop();
      requestAnimationFrame(forceScrollTop);
    });
  }

  function handleOpenReportByContact(contactName: string) {
    const clean = String(contactName || "").trim();
    if (!clean) return;

    if (effectiveActiveView !== "dashboard") {
      openViewAndScrollTop("dashboard");
      window.setTimeout(() => {
        controller.focusReportByContact(clean);
      }, 140);
      return;
    }

    controller.focusReportByContact(clean);
  }

  function handleNavigate(section: string) {
    pendingAnchoredNavigationRef.current = null;
    setActiveSubNavKey(section);
    if (effectiveActiveView !== "dashboard") {
      setActiveView("dashboard");
      setTimeout(() => controller.navigateToSection(section), 0);
      return;
    }
    controller.navigateToSection(section);
  }

  function handleNavigateAnalysis(section: "analysis-overview" | "analysis-movimentacao" | "analysis-conteudo") {
    setActiveSubNavKey(section);
    if (effectiveActiveView !== "analysis") {
      pendingAnchoredNavigationRef.current = { view: "analysis", section };
      setActiveView("analysis");
      return;
    }
    pendingAnchoredNavigationRef.current = null;
    scrollToAnchoredSection(section);
  }

  function handleNavigateClients(section: "clients-filtros" | "clients-kanban") {
    setActiveSubNavKey(section);
    if (effectiveActiveView !== "clients") {
      pendingAnchoredNavigationRef.current = { view: "clients", section };
      setActiveView("clients");
      return;
    }
    pendingAnchoredNavigationRef.current = null;
    scrollToAnchoredSection(section);
  }

  function handleNavigateLogs(section: "logs-saude" | "logs-execucao" | "logs-recentes") {
    setActiveSubNavKey(section);
    if (effectiveActiveView !== "logs") {
      pendingAnchoredNavigationRef.current = { view: "logs", section };
      setActiveView("logs");
      return;
    }
    pendingAnchoredNavigationRef.current = null;
    scrollToAnchoredSection(section);
  }

  function handleNavigateProducts(section: "products-overview" | "products-ranking" | "products-charts") {
    setActiveSubNavKey(section);
    if (effectiveActiveView !== "products") {
      pendingAnchoredNavigationRef.current = { view: "products", section };
      setActiveView("products");
      return;
    }
    pendingAnchoredNavigationRef.current = null;
    scrollToAnchoredSection(section);
  }

  function handleNavigateDissatisfaction(section: "dissatisfaction-overview" | "dissatisfaction-filters" | "dissatisfaction-list") {
    setActiveSubNavKey(section);
    if (effectiveActiveView !== "dissatisfaction") {
      pendingAnchoredNavigationRef.current = { view: "dissatisfaction", section };
      setActiveView("dissatisfaction");
      return;
    }
    pendingAnchoredNavigationRef.current = null;
    scrollToAnchoredSection(section);
  }

  function handleNavigateAttendants(section: "attendants-overview" | "attendants-breakdown" | "attendants-comparison") {
    setActiveSubNavKey(section);
    if (effectiveActiveView !== "attendants") {
      pendingAnchoredNavigationRef.current = { view: "attendants", section };
      setActiveView("attendants");
      return;
    }
    pendingAnchoredNavigationRef.current = null;
    scrollToAnchoredSection(section);
  }

  function handleNavigateSettings(
    section: "settings-profile" | "settings-security" | "settings-preferences",
  ) {
    setActiveSubNavKey(section);
    if (effectiveActiveView !== "settings") {
      pendingAnchoredNavigationRef.current = { view: "settings", section };
      setActiveView("settings");
      return;
    }
    pendingAnchoredNavigationRef.current = null;
    scrollToAnchoredSection(section);
  }

  function handleNavigateSuperadmin(section: "superadmin-accounts") {
    if (!isSuperadmin) {
      pendingAnchoredNavigationRef.current = null;
      setActiveView("settings");
      return;
    }
    setActiveSubNavKey(section);
    if (effectiveActiveView !== "superadmin") {
      pendingAnchoredNavigationRef.current = { view: "superadmin", section };
      setActiveView("superadmin");
      return;
    }
    pendingAnchoredNavigationRef.current = null;
    scrollToAnchoredSection(section);
  }

  async function handleConfirmRun() {
    setShowConfirmModal(false);
    setDismissedRunWarningId(null);
    setDismissedRunFailureStatus("");
    setRunFailureMessage("");
    await controller.executeOverview();
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isAuthenticating) return;
    setLoginError("");
    if (!email.trim() || !password.trim()) {
      setLoginError("Preencha e-mail e senha para continuar.");
      return;
    }

    setIsAuthenticating(true);
    try {
      const { data, error } = await supabaseBrowser.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error || !data.session) {
        setLoginError("Credenciais inválidas ou acesso indisponível.");
        return;
      }

      const status = await fetchAuthStatusWithRetry();
      if (!status?.authenticated || !status?.authorized || !status.user) {
        await supabaseBrowser.auth.signOut();
        setLoginError("Não foi possível validar sua sessão. Tente entrar novamente.");
        return;
      }

      if (rememberMe) localStorage.setItem("hile_remember", "true");
      else localStorage.removeItem("hile_remember");
      sessionStorage.setItem("hile_tab_session", "true");
      writeLastActivity(status.user.email);

      const meta = data.session.user?.user_metadata || {};
      setCurrentUser({
        name: meta.name || toPrettyName(status.user.email),
        email: status.user.email || "usuario@hile.com.br",
        role: toPrettyRole(status.user.role),
      });
      setStage("app");
    } catch {
      setLoginError("Falha de conexão durante autenticação.");
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function handleLogout() {
    clearLastActivity(currentUser?.email || null);
    await supabaseBrowser.auth.signOut();
    setStage("login");
    setCurrentUser(null);
    setPassword("");
    setShowPassword(false);
    setIsAuthenticating(false);
    setLoginError("");
    setShowForgotPasswordModal(false);
    setShowConfirmModal(false);
    setShowLogoutConfirmModal(false);
    setActiveView("dashboard");
  }

  function handleUpdateProfile(updates: { name?: string; role?: string }) {
    setCurrentUser((prev) => (prev ? { ...prev, ...updates } : prev));
  }

  if (stage === "splash") return <SplashScreen />;
  if (stage === "boot") return null;

  if (stage === "login") {
    return (
      <LoginScreen
        email={email}
        password={password}
        showPassword={showPassword}
        rememberMe={rememberMe}
        isAuthenticating={isAuthenticating}
        loginError={loginError}
        showForgotPasswordModal={showForgotPasswordModal}
        onSubmit={handleLogin}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onTogglePassword={() => setShowPassword((value) => !value)}
        onRememberMeChange={setRememberMe}
        onForgotPassword={() => {
          setLoginError("");
          setShowForgotPasswordModal(true);
        }}
        onCloseForgotPasswordModal={() => setShowForgotPasswordModal(false)}
      />
    );
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <ShellNavigation
        activeView={effectiveActiveView}
        activeSubNavKey={activeSubNavKey}
        navClass={controller.navClass}
        onNavigate={handleNavigate}
        onOpenSettings={() => openViewAndScrollTop("settings")}
          onOpenDashboard={() => {
            setActiveSubNavKey("inicio");
            if (effectiveActiveView !== "dashboard") {
              setActiveView("dashboard");
              setTimeout(() => controller.navigateToSection("inicio"), 0);
              return;
            }
            controller.navigateToSection("inicio");
        }}
        onOpenClients={() => openViewAndScrollTop("clients")}
        onOpenAnalysis={() => {
          setAnalysisScope("day");
          openViewAndScrollTop("analysis", "analysis-overview");
        }}
        onOpenDissatisfaction={() => {
          setDissatisfactionScope("day");
          openViewAndScrollTop("dissatisfaction", "dissatisfaction-overview");
        }}
        onOpenAttendants={() => openViewAndScrollTop("attendants", "attendants-overview")}
        onOpenProducts={() => openViewAndScrollTop("products", "products-overview")}
        onOpenLogs={() => openViewAndScrollTop("logs")}
        onOpenSuperadmin={() => openViewAndScrollTop("superadmin", "superadmin-accounts")}
        onNavigateAnalysis={handleNavigateAnalysis}
        onNavigateDissatisfaction={handleNavigateDissatisfaction}
        onNavigateAttendants={handleNavigateAttendants}
        onNavigateClients={handleNavigateClients}
        onNavigateProducts={handleNavigateProducts}
        onNavigateLogs={handleNavigateLogs}
        onNavigateSuperadmin={handleNavigateSuperadmin}
        onNavigateSettings={handleNavigateSettings}
        currentUser={currentUser || { name: "Usuário", email: "usuario@hile.com.br", role: "Operador" }}
        onLogout={() => setShowLogoutConfirmModal(true)}
        notificationState={notificationState}
        onClearNotifications={clearNotifications}
        onClearNotification={clearNotification}
        onOpenView={(view) => openViewAndScrollTop(view)}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
      />

      <main className="main-content-shell">
        <div className="main-view-slot">
          <MainContentRenderer
            activeView={effectiveActiveView}
            analysisScope={analysisScope}
            dissatisfactionScope={dissatisfactionScope}
            controller={controller}
            clientsSnapshotDate={clientsSnapshotDate}
            selectedDateKnownRunId={selectedDateKnownRunId}
            currentUser={currentUser}
            onRequestOverview={() => setShowConfirmModal(true)}
            onOpenLogs={() => openViewAndScrollTop("logs")}
            onOpenReportByContact={handleOpenReportByContact}
            onSetAnalysisScope={setAnalysisScope}
            onSetDissatisfactionScope={setDissatisfactionScope}
            ownerScope={ownerScope}
            onSetOwnerScope={setOwnerScope}
            onUpdateProfile={handleUpdateProfile}
          />
        </div>
        <AppFooter />
      </main>

      <AppModals
        showConfirmModal={showConfirmModal}
        showRunWarningModal={shouldShowRunWarningModal}
        showRunFailureModal={shouldShowRunFailureModal}
        showLogoutConfirmModal={showLogoutConfirmModal}
        isDashboardView={effectiveActiveView === "dashboard"}
        selectedDateHasSavedReport={controller.selectedDateHasSavedReport}
        runFailureMessage={runFailureSummary}
        onCancelConfirmRun={() => setShowConfirmModal(false)}
        onConfirmRun={() => void handleConfirmRun()}
        onCloseRunWarning={() => setDismissedRunWarningId(controller.currentRunId || "running")}
        onCloseRunFailure={() => setDismissedRunFailureStatus(runStatusText)}
        onCancelLogout={() => setShowLogoutConfirmModal(false)}
        onConfirmLogout={() => void handleLogout()}
        onOpenLogs={() => openViewAndScrollTop("logs")}
      />
    </div>
  );
}
