"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { FiEye, FiEyeOff, FiLock, FiMail } from "react-icons/fi";
import { useDashboardController } from "@/features/dashboard/hooks/useDashboardController";
import { useRevealOnScroll } from "@/features/dashboard/hooks/useRevealOnScroll";
import { useNotifications } from "@/features/dashboard/hooks/useNotifications";
import { AppFooter } from "@/features/dashboard/sections/AppFooter";
import { GapsSection } from "@/features/dashboard/sections/GapsSection";
import { InsightsSection } from "@/features/dashboard/sections/InsightsSection";
import { AccountsView } from "@/features/dashboard/sections/AccountsView";
import { LogsView } from "@/features/dashboard/sections/LogsView";
import { MetricsSection } from "@/features/dashboard/sections/MetricsSection";
import { MovementSection } from "@/features/dashboard/sections/MovementSection";
import { ProductsOverallView } from "@/features/dashboard/sections/ProductsOverallView";
import { ProductsView } from "@/features/dashboard/sections/ProductsView";
import { ReportSection } from "@/features/dashboard/sections/ReportSection";
import { SettingsView } from "@/features/dashboard/sections/SettingsView";
import { ShellNavigation } from "@/features/dashboard/sections/ShellNavigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type AppView = "dashboard" | "clients" | "analysis" | "products" | "logs" | "settings";

interface AuthStatusPayload {
  authenticated: boolean;
  authorized: boolean;
  user: {
    id: string;
    email: string | null;
  } | null;
}

export default function Page() {
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [activeView, setActiveView] = useState<AppView>(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem("hile_active_view");
      if (saved === "dashboard" || saved === "clients" || saved === "analysis" || saved === "products" || saved === "logs" || saved === "settings") return saved;
    }
    return "dashboard";
  });
  const [stage, setStage] = useState<"boot" | "splash" | "login" | "app">("boot");
  const [viewAnimationKey, setViewAnimationKey] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [showLogoutConfirmModal, setShowLogoutConfirmModal] = useState(false);
  const [activeSubNavKey, setActiveSubNavKey] = useState<string>("inicio");
  const [currentUser, setCurrentUser] = useState<{ name: string; email: string; role: string } | null>(null);
  useRevealOnScroll({ enabled: stage === "app" });
  const controller = useDashboardController({ enabled: stage === "app" });

  const notifyPrefs = useMemo(() => {
    try {
      return {
        report: localStorage.getItem("hile_settings_notify_report") !== "false",
        log: localStorage.getItem("hile_settings_notify_log") !== "false",
        client: localStorage.getItem("hile_settings_notify_client") !== "false",
      };
    } catch { return { report: true, log: true, client: true }; }
  }, [stage]);

  const { state: notificationState, clear: clearNotifications } = useNotifications({
    enabled: stage === "app",
    notifyReport: notifyPrefs.report,
    notifyLog: notifyPrefs.log,
    notifyClient: notifyPrefs.client,
    currentDate: controller.date,
  });

  const clientsSnapshotDate = useMemo(() => {
    return controller.reportHistory[0]?.date_ref || controller.date;
  }, [controller.date, controller.reportHistory]);

  const selectedDateKnownRunId = useMemo(() => {
    let bestRun: { id: string; started_at: string } | null = null;
    for (const run of controller.reportHistory) {
      if (run.date_ref !== clientsSnapshotDate || !run.has_report) continue;
      if (!bestRun) {
        bestRun = { id: run.id, started_at: run.started_at };
        continue;
      }
      if (new Date(run.started_at).getTime() > new Date(bestRun.started_at).getTime()) {
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
      const response = await fetch("/api/auth/status", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) return null;
      const data = (await response.json()) as AuthStatusPayload;
      return data;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    let cancelled = false;
    const shouldShowSplash = window.sessionStorage.getItem("hile_splash_seen") !== "1";
    if (shouldShowSplash) {
      window.sessionStorage.setItem("hile_splash_seen", "1");
      setStage("splash");
    }
    const delayMs = shouldShowSplash ? 2300 : 0;
    const timer = window.setTimeout(() => {
      void (async () => {
        const {
          data: { session },
        } = await supabaseBrowser.auth.getSession();

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
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem("hile_active_view", activeView); } catch { /* noop */ }
    if (stage !== "app") return;
    setViewAnimationKey((value) => value + 1);
  }, [activeView, stage]);

  useEffect(() => {
    if (activeView === "dashboard") setActiveSubNavKey("inicio");
    if (activeView === "clients") setActiveSubNavKey("clients-filtros");
    if (activeView === "analysis") setActiveSubNavKey("analysis-overview");
    if (activeView === "products") setActiveSubNavKey("");
    if (activeView === "logs") setActiveSubNavKey("logs-saude");
    if (activeView === "settings") setActiveSubNavKey("settings-profile");
  }, [activeView]);

  useEffect(() => {
    if (stage !== "app") return;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [activeView, stage]);

  useEffect(() => {
    if (stage !== "app" || !controller.isRunningOverview) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [controller.isRunningOverview, stage]);

  async function handleConfirmRun() {
    setShowConfirmModal(false);
    await controller.executeOverview();
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

  function scrollToAnchoredSection(sectionId: string) {
    const target = document.getElementById(sectionId);
    if (!target) return;
    setActiveSubNavKey(sectionId);
    const top = Math.max(0, target.offsetTop - 68);
    window.scrollTo({ top, behavior: "smooth" });
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

  function handleNavigateSettings(section: "settings-profile" | "settings-security" | "settings-preferences") {
    if (activeView !== "settings") {
      setActiveView("settings");
      setTimeout(() => scrollToAnchoredSection(section), 0);
      return;
    }
    scrollToAnchoredSection(section);
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

        if (rememberMe) {
          localStorage.setItem("hile_remember", "true");
        } else {
          localStorage.removeItem("hile_remember");
        }
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
      timer = window.setTimeout(() => {
        void forceLogoutByInactivity();
      }, sessionIdleTimeoutMs);
    };

    const events: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    for (const eventName of events) {
      window.addEventListener(eventName, resetIdleTimer, { passive: true });
    }
    resetIdleTimer();

    return () => {
      if (timer) window.clearTimeout(timer);
      for (const eventName of events) {
        window.removeEventListener(eventName, resetIdleTimer);
      }
    };
  }, [sessionIdleTimeoutMs, stage]);

  function handleForgotPassword() {
    setLoginError("");
    setShowForgotPasswordModal(true);
  }

  function handleOpenSettings() {
    setActiveView("settings");
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  function handleOpenClients() {
    setActiveView("clients");
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  function handleOpenLogs() {
    setActiveView("logs");
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  function handleOpenProducts() {
    setActiveView("products");
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  function handleOpenAnalysis() {
    setActiveView("analysis");
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  function handleOpenDashboard() {
    setActiveSubNavKey("inicio");
    if (activeView !== "dashboard") {
      setActiveView("dashboard");
      setTimeout(() => controller.navigateToSection("inicio"), 0);
      return;
    }
    controller.navigateToSection("inicio");
  }

  function handleUpdateProfile(updates: { name?: string; role?: string }) {
    setCurrentUser((prev) =>
      prev ? { ...prev, ...updates } : prev
    );
  }

  function handleOpenView(view: "clients" | "logs") {
    setActiveView(view);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  if (stage === "splash") {
    return (
      <div className="splash-screen">
        <div className="splash-logo">
          <img src="/logo_hile1.png" alt="Hilê" />
        </div>
        <div className="splash-copy">
          <h1>
            PAINEL <span>DE AUDITORIA</span>
          </h1>
          <p>Inicializando painel operacional...</p>
        </div>
      </div>
    );
  }

  if (stage === "boot") {
    return null;
  }

  if (stage === "login") {
    return (
      <div className="login-screen">
        <div className="login-blob login-blob-1" />
        <div className="login-blob login-blob-2" />
        <div className="login-blob login-blob-3" />

        <form className="login-card login-card-advanced" onSubmit={handleLogin}>
          <div className="login-card-header">
            <img className="login-brand-logo" src="/logo_hile1.png" alt="Hilê" />
            <h1>
              PAINEL <span>DE AUDITORIA</span>
            </h1>
            <p>PAINEL OPERACIONAL</p>
          </div>

          <div className="login-card-body">
            <div className="login-field">
              <label htmlFor="login-email">EMAIL DE ACESSO</label>
              <div className="login-field-row">
                <span className="field-icon">
                  <FiMail aria-hidden="true" />
                </span>
                <span className="field-sep" />
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Digite seu email"
                  disabled={isAuthenticating}
                />
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="login-password">SENHA</label>
              <div className="login-field-row">
                <span className="field-icon">
                  <FiLock aria-hidden="true" />
                </span>
                <span className="field-sep" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Digite sua senha"
                  disabled={isAuthenticating}
                />
                <button
                  type="button"
                  className="password-visibility-btn"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  disabled={isAuthenticating}
                >
                  {showPassword ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
                </button>
              </div>
            </div>

            <div className="login-options-row">
              <label className="remember-check">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  disabled={isAuthenticating}
                />
                <span>Lembrar de mim</span>
              </label>
              <button
                className="forgot-link"
                type="button"
                onClick={handleForgotPassword}
                disabled={isAuthenticating}
              >
                Esqueceu a senha
              </button>
            </div>

            {loginError ? <p className="login-error">{loginError}</p> : null}

            <button className="login-btn" type="submit" disabled={isAuthenticating}>
              {isAuthenticating ? "Autenticando..." : "Acessar Sistema"}
            </button>

            <p className="login-visual-hint">Acesso disponível para usuários autenticados.</p>
          </div>

          <div className="secure-session-strip" role="status" aria-live="polite">
            <span className="secure-session-dot" aria-hidden="true" />
            <span>SESSÃO SEGURA</span>
            <span className="secure-session-divider" aria-hidden="true">|</span>
            <span>SSL PROTEGIDO</span>
          </div>
        </form>

        <AppFooter loginMode />

        {showForgotPasswordModal ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="forgotPasswordModalTitle">
            <div className="modal-card">
              <h3 id="forgotPasswordModalTitle">Funcionalidade em desenvolvimento</h3>
              <p>O fluxo de recuperação de senha ainda está em desenvolvimento neste projeto.</p>
              <div className="modal-actions">
                <button className="btn btn-primary btn-sm" onClick={() => setShowForgotPasswordModal(false)}>
                  Entendi
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <ShellNavigation
        activeView={activeView}
        activeSubNavKey={activeSubNavKey}
        navClass={controller.navClass}
        onNavigate={handleNavigate}
        onOpenSettings={handleOpenSettings}
        onOpenDashboard={handleOpenDashboard}
        onOpenClients={handleOpenClients}
        onOpenAnalysis={handleOpenAnalysis}
        onOpenProducts={handleOpenProducts}
        onOpenLogs={handleOpenLogs}
        onNavigateAnalysis={handleNavigateAnalysis}
        onNavigateClients={handleNavigateClients}
        onNavigateLogs={handleNavigateLogs}
        onNavigateSettings={handleNavigateSettings}
        currentUser={currentUser || { name: "Usuário", email: "usuario@hile.com.br", role: "Operador" }}
        onLogout={() => setShowLogoutConfirmModal(true)}
        notificationState={notificationState}
        onClearNotifications={clearNotifications}
        onOpenView={handleOpenView}
      />

      <main className="main-content-shell">
        <div className="main-view-slot">
          {activeView === "dashboard" ? (
          <div className="dashboard-animated" key={`dashboard-${viewAnimationKey}`}>
            <MetricsSection
              date={controller.date}
              setDate={controller.setDate}
              minDate={controller.minDate}
              maxDate={controller.maxDate}
              periodPreset={controller.periodPreset}
              applyPeriodPreset={controller.applyPeriodPreset}
              isBusy={controller.isBusy}
              isRunningOverview={controller.isRunningOverview}
              onRequestOverview={() => setShowConfirmModal(true)}
              onOpenLogs={handleOpenLogs}
              overview={controller.overview}
              severitySnapshot={controller.severitySnapshot}
              runProgress={controller.runProgress}
              runCurrentContact={controller.runCurrentContact}
              runTimeline={controller.runTimeline}
              selectedDateInfo={controller.selectedDateInfo}
              selectedDateHasSavedReport={controller.selectedDateHasSavedReport}
              clientAvgResponseMinutes={controller.clientAvgResponseMinutes}
              clientPeakHourLabel={controller.clientPeakHourLabel}
            />

            <GapsSection
              insightsReady={controller.insightsReady}
              criticalGapInsights={controller.criticalGapInsights}
              overview={controller.overview}
              chatwootBaseUrl={controller.apiConfig?.chatwoot_base_url || ""}
              onOpenReportByContact={controller.focusReportByContact}
              operationalAlerts={controller.operationalAlerts}
            />

            <InsightsSection
              insightsReady={controller.insightsReady}
              gaugeData={controller.gaugeData}
              overviewRunCount={controller.overviewRunCount}
              riskRows={controller.riskRows}
              insightFilter={controller.insightFilter}
              setInsightFilter={controller.setInsightFilter}
              filteredInsights={controller.filteredInsights}
              visibleInsights={controller.visibleInsights}
              insightsPage={controller.insightsPage}
              totalInsightPages={controller.totalInsightPages}
              setInsightsPage={controller.setInsightsPage}
              onOpenReportByContact={controller.focusReportByContact}
            />

            <ReportSection
              criticalGapInsights={controller.criticalGapInsights}
              report={controller.report}
              reportHistory={controller.reportHistory}
              selectedReportContact={controller.selectedReportContact}
              onSelectReportContact={controller.setSelectedReportContact}
              reportSeverityFilter={controller.reportSeverityFilter}
              onChangeReportSeverityFilter={controller.setReportSeverityFilter}
              selectedDate={controller.date}
            />
          </div>
          ) : activeView === "clients" ? (
            <div className="settings-animated" key={`clients-${viewAnimationKey}`}>
              <AccountsView
                selectedDate={clientsSnapshotDate}
                knownRunId={selectedDateKnownRunId}
                refreshHint={controller.lastRunAt}
              />
            </div>
          ) : activeView === "logs" ? (
            <div className="settings-animated" key={`logs-${viewAnimationKey}`}>
              <LogsView
                systemCheck={controller.systemCheck}
                reportHistory={controller.reportHistory}
                currentStatus={controller.status}
                isRunningOverview={controller.isRunningOverview}
                currentRunId={controller.currentRunId}
                runProgress={controller.runProgress}
                runCurrentContact={controller.runCurrentContact}
                runTimeline={controller.runTimeline}
              />
            </div>
          ) : activeView === "analysis" ? (
            <div className="settings-animated" key={`analysis-${viewAnimationKey}`}>
              <div className="section reveal" id="analysis-overview">
                <div className="section-inner">
                  <div className="section-header">
                    <span className="section-num">01</span>
                    <div className="section-title">
                      <h2>Análise Geral do Dia</h2>
                      <p>Esta análise geral reflete exatamente os dados do dia selecionado: {controller.date}.</p>
                    </div>
                  </div>
                </div>
              </div>

              <section className="analysis-content-shell">
                <article className="settings-card">
                  <div className="settings-card-head">Como interpretar esta análise</div>
                  <div className="settings-card-body">
                    <p>
                      <strong>Análise do Dia:</strong> sempre considera somente os dados da data selecionada no período.
                    </p>
                    <p>
                      <strong>Movimentação:</strong> mostra volume horário e distribuição de severidade para o mesmo dia.
                    </p>
                    <p>
                      <strong>Produtos e Contexto:</strong> lista produtos detectados e insights informativos desse dia, sem misturar com outras datas.
                    </p>
                  </div>
                </article>
              </section>

              <MovementSection
                trendSeries={controller.trendSeries}
                severitySnapshot={controller.severitySnapshot}
                totalMessagesDay={controller.overview?.overview.total_messages_day ?? 0}
                totalConversationsDay={controller.overview?.overview.conversations_total_analyzed_day ?? 0}
                sectionId="analysis-movimentacao"
                sectionNumber="02"
              />

              <div className="section reveal" id="analysis-conteudo">
                <div className="section-inner">
                  <div className="section-header">
                    <span className="section-num">03</span>
                    <div className="section-title">
                      <h2>Produtos e Contexto</h2>
                      <p>Produtos procurados e insights informativos do dia selecionado</p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <ProductsView
                  items={controller.productDemand}
                  selectedDate={controller.date}
                  informationalInsights={controller.informationalInsights}
                  showHeader={false}
                />
              </div>
            </div>
          ) : activeView === "products" ? (
            <div className="settings-animated" key={`products-${viewAnimationKey}`}>
              <ProductsOverallView />
            </div>
          ) : (
            <div className="settings-animated" key={`settings-${viewAnimationKey}`}>
              <SettingsView
                currentUser={currentUser || { name: "Usuário", email: "usuario@hile.com.br", role: "Operador" }}
                onUpdateProfile={handleUpdateProfile}
              />
            </div>
          )}
        </div>

        <AppFooter />
      </main>

        {showConfirmModal && activeView === "dashboard" ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirmOverviewTitle">
            <div className="modal-card">
              <h3 id="confirmOverviewTitle">Executar overview agora?</h3>
              <p>
                Vamos checar conexões, buscar conversas do dia, rodar análise e atualizar o relatório.
              </p>
              <p>
                Esta execução vai consolidar os dados do dia e atualizar o relatório salvo para a data selecionada.
              </p>
              {controller.selectedDateHasSavedReport ? (
                <p style={{ color: "var(--critical)" }}>
                  Já existe relatório salvo para essa data. Se continuar, o novo relatório vai substituir o anterior.
              </p>
            ) : null}
            <div className="modal-actions">
              <button className="btn btn-sm" onClick={() => setShowConfirmModal(false)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={() => void handleConfirmRun()}>Confirmar e executar</button>
            </div>
          </div>
        </div>
      ) : null}

      {showLogoutConfirmModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirmLogoutTitle">
          <div className="modal-card">
            <h3 id="confirmLogoutTitle">Sair da conta?</h3>
            <p>Você deseja realmente encerrar sua sessão agora?</p>
            <div className="modal-actions">
              <button className="btn btn-sm" onClick={() => setShowLogoutConfirmModal(false)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={() => void handleLogout()}>Sair da conta</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
