"use client";

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
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
  const [showRunWarningModal, setShowRunWarningModal] = useState(false);
  const [activeSubNavKey, setActiveSubNavKey] = useState<string>("inicio");
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

  useRevealOnScroll({ enabled: stage === "app", viewKey: activeView });

  const controller = useDashboardController({
    enabled: stage === "app",
    syncNavOnScroll: stage === "app" && activeView === "dashboard",
  });

  const notifyPrefs = useMemo(() => {
    try {
      return {
        report: localStorage.getItem("hile_settings_notify_report") !== "false",
        log: localStorage.getItem("hile_settings_notify_log") !== "false",
        client: localStorage.getItem("hile_settings_notify_client") !== "false",
      };
    } catch {
      return { report: true, log: true, client: true };
    }
  }, []);

  const { state: notificationState, clear: clearNotifications, clearOne: clearNotification } = useNotifications({
    enabled: stage === "app",
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

  async function fetchAuthStatus(): Promise<AuthStatusPayload | null> {
    try {
      const response = await fetch("/api/auth/status", { method: "GET", cache: "no-store" });
      if (!response.ok) return null;
      return (await response.json()) as AuthStatusPayload;
    } catch {
      return null;
    }
  }

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

        const status = await fetchAuthStatus();
        if (!status?.authenticated || !status?.authorized || !status.user) {
          await supabaseBrowser.auth.signOut();
          if (!cancelled) {
            setLoginError("Não foi possível validar seu acesso. Faça login novamente.");
            setStage("login");
          }
          return;
        }

        if (!cancelled) {
          const meta = session.user?.user_metadata || {};
          setCurrentUser({
            name: meta.name || toPrettyName(status.user.email),
            email: status.user.email || "usuario@hile.com.br",
            role: meta.role || "Administrador",
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
  }, [clearStaleAuthStorage]);

  useEffect(() => {
    try {
      sessionStorage.setItem("hile_active_view", activeView);
    } catch {
      // noop
    }
  }, [activeView]);

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
      activeView === "dashboard"
        ? "inicio"
        : activeView === "clients"
          ? "clients-filtros"
          : activeView === "analysis"
            ? "analysis-overview"
            : activeView === "attendants"
              ? "attendants-overview"
              : activeView === "dissatisfaction"
                ? "dissatisfaction-overview"
                : activeView === "products"
                  ? "products-overview"
                  : activeView === "logs"
                    ? "logs-saude"
                    : "settings-profile";

    const raf = requestAnimationFrame(() => setActiveSubNavKey(nextKey));
    return () => cancelAnimationFrame(raf);
  }, [activeView]);

  useEffect(() => {
    if (stage !== "app" || activeView === "dashboard") return;
    const sectionKeys = VIEW_SECTION_KEYS[activeView];
    if (!sectionKeys || sectionKeys.length === 0) return;

    const offsetTop = 96;
    const syncActiveSection = () => {
      let bestKey = sectionKeys[0];
      let bestTopDistance = Number.POSITIVE_INFINITY;
      for (const key of sectionKeys) {
        const element = document.getElementById(key);
        if (!element) continue;
        const top = element.getBoundingClientRect().top;
        const distanceFromMarker = Math.abs(top - offsetTop);
        if (top <= offsetTop && distanceFromMarker < bestTopDistance) {
          bestTopDistance = distanceFromMarker;
          bestKey = key;
        }
      }
      if (bestTopDistance === Number.POSITIVE_INFINITY) {
        for (const key of sectionKeys) {
          const element = document.getElementById(key);
          if (element) {
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
  }, [activeView, stage]);

  useLayoutEffect(() => {
    if (stage !== "app") return;
    forceScrollTop();
    requestAnimationFrame(() => {
      forceScrollTop();
      requestAnimationFrame(forceScrollTop);
    });
  }, [activeView, forceScrollTop, stage]);

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

    const forceLogoutByInactivity = async () => {
      if (didLogout) return;
      didLogout = true;
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
  }, [sessionIdleTimeoutMs, stage]);

  function scrollToAnchoredSection(sectionId: string) {
    const target = document.getElementById(sectionId);
    if (!target) return;
    setActiveSubNavKey(sectionId);
    const top = Math.max(0, target.offsetTop - 68);
    window.scrollTo({ top, behavior: "smooth" });
  }

  function openViewAndScrollTop(view: AppView, subNavKey?: string) {
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

    if (activeView !== "dashboard") {
      openViewAndScrollTop("dashboard");
      window.setTimeout(() => {
        controller.focusReportByContact(clean);
      }, 140);
      return;
    }

    controller.focusReportByContact(clean);
  }

  function handleNavigate(section: string) {
    setActiveSubNavKey(section);
    if (activeView !== "dashboard") {
      setActiveView("dashboard");
      setTimeout(() => controller.navigateToSection(section), 0);
      return;
    }
    controller.navigateToSection(section);
  }

  function handleNavigateAnalysis(section: "analysis-overview" | "analysis-movimentacao" | "analysis-conteudo") {
    if (activeView !== "analysis") {
      setActiveView("analysis");
      setTimeout(() => scrollToAnchoredSection(section), 0);
      return;
    }
    scrollToAnchoredSection(section);
  }

  function handleNavigateClients(section: "clients-filtros" | "clients-kanban") {
    if (activeView !== "clients") {
      setActiveView("clients");
      setTimeout(() => scrollToAnchoredSection(section), 0);
      return;
    }
    scrollToAnchoredSection(section);
  }

  function handleNavigateLogs(section: "logs-saude" | "logs-execucao" | "logs-recentes") {
    if (activeView !== "logs") {
      setActiveView("logs");
      setTimeout(() => scrollToAnchoredSection(section), 0);
      return;
    }
    scrollToAnchoredSection(section);
  }

  function handleNavigateProducts(section: "products-overview" | "products-ranking" | "products-charts") {
    if (activeView !== "products") {
      setActiveView("products");
      setTimeout(() => scrollToAnchoredSection(section), 0);
      return;
    }
    scrollToAnchoredSection(section);
  }

  function handleNavigateDissatisfaction(section: "dissatisfaction-overview" | "dissatisfaction-filters" | "dissatisfaction-list") {
    if (activeView !== "dissatisfaction") {
      setActiveView("dissatisfaction");
      setTimeout(() => scrollToAnchoredSection(section), 0);
      return;
    }
    scrollToAnchoredSection(section);
  }

  function handleNavigateAttendants(section: "attendants-overview" | "attendants-breakdown" | "attendants-comparison") {
    if (activeView !== "attendants") {
      setActiveView("attendants");
      setTimeout(() => scrollToAnchoredSection(section), 0);
      return;
    }
    scrollToAnchoredSection(section);
  }

  function handleNavigateSettings(section: "settings-profile" | "settings-security" | "settings-preferences") {
    if (activeView !== "settings") {
      setActiveView("settings");
      setTimeout(() => scrollToAnchoredSection(section), 0);
      return;
    }
    scrollToAnchoredSection(section);
  }

  async function handleConfirmRun() {
    setShowConfirmModal(false);
    setShowRunWarningModal(true);
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

      const status = await fetchAuthStatus();
      if (!status?.authenticated || !status?.authorized || !status.user) {
        await supabaseBrowser.auth.signOut();
        setLoginError("Não foi possível validar sua sessão. Tente entrar novamente.");
        return;
      }

      if (rememberMe) localStorage.setItem("hile_remember", "true");
      else localStorage.removeItem("hile_remember");
      sessionStorage.setItem("hile_tab_session", "true");

      const meta = data.session.user?.user_metadata || {};
      setCurrentUser({
        name: meta.name || toPrettyName(status.user.email),
        email: status.user.email || "usuario@hile.com.br",
        role: meta.role || "Administrador",
      });
      setStage("app");
    } catch {
      setLoginError("Falha de conexão durante autenticação.");
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function handleLogout() {
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
        activeView={activeView}
        activeSubNavKey={activeSubNavKey}
        navClass={controller.navClass}
        onNavigate={handleNavigate}
        onOpenSettings={() => openViewAndScrollTop("settings")}
        onOpenDashboard={() => {
          setActiveSubNavKey("inicio");
          if (activeView !== "dashboard") {
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
        onNavigateAnalysis={handleNavigateAnalysis}
        onNavigateDissatisfaction={handleNavigateDissatisfaction}
        onNavigateAttendants={handleNavigateAttendants}
        onNavigateClients={handleNavigateClients}
        onNavigateProducts={handleNavigateProducts}
        onNavigateLogs={handleNavigateLogs}
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
            activeView={activeView}
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
        showRunWarningModal={showRunWarningModal}
        showLogoutConfirmModal={showLogoutConfirmModal}
        isDashboardView={activeView === "dashboard"}
        selectedDateHasSavedReport={controller.selectedDateHasSavedReport}
        onCancelConfirmRun={() => setShowConfirmModal(false)}
        onConfirmRun={() => void handleConfirmRun()}
        onCloseRunWarning={() => setShowRunWarningModal(false)}
        onCancelLogout={() => setShowLogoutConfirmModal(false)}
        onConfirmLogout={() => void handleLogout()}
      />
    </div>
  );
}
