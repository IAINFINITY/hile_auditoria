"use client";

import { FormEvent, useEffect, useState } from "react";
import { FiEye, FiEyeOff, FiLock, FiMail } from "react-icons/fi";
import { FaFacebookF, FaInstagram, FaLinkedinIn, FaXTwitter } from "react-icons/fa6";
import { useDashboardController } from "@/features/dashboard/hooks/useDashboardController";
import { useRevealOnScroll } from "@/features/dashboard/hooks/useRevealOnScroll";
import { GapsSection } from "@/features/dashboard/sections/GapsSection";
import { InsightsSection } from "@/features/dashboard/sections/InsightsSection";
import { MetricsSection } from "@/features/dashboard/sections/MetricsSection";
import { MovementSection } from "@/features/dashboard/sections/MovementSection";
import { ReportSection } from "@/features/dashboard/sections/ReportSection";
import { SettingsView } from "@/features/dashboard/sections/SettingsView";
import { ShellNavigation } from "@/features/dashboard/sections/ShellNavigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type AppView = "dashboard" | "settings";

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
  const [activeView, setActiveView] = useState<AppView>("dashboard");
  const [stage, setStage] = useState<"splash" | "login" | "app">("splash");
  const [viewAnimationKey, setViewAnimationKey] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ name: string; email: string; role: string } | null>(null);
  useRevealOnScroll({ enabled: stage === "app" });
  const controller = useDashboardController({ enabled: stage === "app" });

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

    const timer = window.setTimeout(() => {
      void (async () => {
        const {
          data: { session },
        } = await supabaseBrowser.auth.getSession();

        if (!session) {
          if (!cancelled) setStage("login");
          return;
        }

        const status = await fetchAuthStatus();
        if (!status?.authenticated || !status?.authorized || !status.user) {
          await supabaseBrowser.auth.signOut();
          if (!cancelled) {
            setLoginError("Este usuário não possui acesso autorizado no banco de dados.");
            setStage("login");
          }
          return;
        }

        if (!cancelled) {
          setCurrentUser({
            name: toPrettyName(status.user.email),
            email: status.user.email || "usuario@hile.com.br",
            role: "Administrador",
          });
          setStage("app");
        }
      })();
    }, 2300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (stage !== "app") return;
    setViewAnimationKey((value) => value + 1);
  }, [activeView, stage]);

  useEffect(() => {
    if (stage !== "app") return;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [activeView, stage]);

  async function handleConfirmRun() {
    setShowConfirmModal(false);
    await controller.executeOverview();
  }

  function handleNavigate(section: string) {
    if (activeView !== "dashboard") {
      setActiveView("dashboard");
      setTimeout(() => controller.navigateToSection(section), 0);
      return;
    }
    controller.navigateToSection(section);
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
        setLoginError("Seu usuário autenticou, mas não está autorizado no banco.");
        return;
      }

      setCurrentUser({
        name: toPrettyName(status.user.email),
        email: status.user.email || "usuario@hile.com.br",
        role: "Administrador",
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
    setActiveView("dashboard");
  }

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

            <p className="login-visual-hint">Acesso restrito a usuários autorizados no banco de dados.</p>
          </div>

          <div className="secure-session-strip" role="status" aria-live="polite">
            <span className="secure-session-dot" aria-hidden="true" />
            <span>SESSÃO SEGURA</span>
            <span className="secure-session-divider" aria-hidden="true">|</span>
            <span>SSL PROTEGIDO</span>
          </div>
        </form>

        <footer className="brand-footer login-page-footer">
          <div className="brand-footer-left">Dev by <strong>IA Infinity</strong></div>
          <div className="brand-footer-center">© 2026 Hilê – Fábrica de suplementos alimentares</div>
          <div className="brand-footer-right brand-footer-socials">
            <a href="https://www.facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook">
              <FaFacebookF />
            </a>
            <a href="https://x.com" target="_blank" rel="noreferrer" aria-label="Twitter">
              <FaXTwitter />
            </a>
            <a href="https://www.instagram.com/hileterceirizacao/" target="_blank" rel="noreferrer" aria-label="Instagram">
              <FaInstagram />
            </a>
            <a href="https://www.linkedin.com" target="_blank" rel="noreferrer" aria-label="LinkedIn">
              <FaLinkedinIn />
            </a>
          </div>
        </footer>

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
        navClass={controller.navClass}
        onNavigate={handleNavigate}
        onOpenSettings={handleOpenSettings}
        onOpenDashboard={() => setActiveView("dashboard")}
        currentUser={currentUser || { name: "Usuário", email: "usuario@hile.com.br", role: "Operador" }}
        onLogout={handleLogout}
      />

      <main className="main-content-shell">
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
              lastRunAt={controller.lastRunAt}
              loading={Boolean(controller.loading)}
              systemCheck={controller.systemCheck}
              overview={controller.overview}
              severitySnapshot={controller.severitySnapshot}
              runTimeline={controller.runTimeline}
              runProgress={controller.runProgress}
              runCurrentContact={controller.runCurrentContact}
              selectedDateInfo={controller.selectedDateInfo}
              selectedDateHasSavedReport={controller.selectedDateHasSavedReport}
            />

            <GapsSection
              insightsReady={controller.insightsReady}
              criticalGapInsights={controller.criticalGapInsights}
              overview={controller.overview}
              chatwootBaseUrl={controller.apiConfig?.chatwoot_base_url || ""}
              onOpenReportByContact={controller.focusReportByContact}
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

            <MovementSection
              trendSeries={controller.trendSeries}
              severitySnapshot={controller.severitySnapshot}
              totalMessagesDay={controller.overview?.overview.total_messages_day ?? 0}
              totalConversationsDay={controller.overview?.overview.conversations_total_analyzed_day ?? 0}
            />

            <ReportSection
              criticalGapInsights={controller.criticalGapInsights}
              report={controller.report}
              reportHistory={controller.reportHistory}
              selectedReportContact={controller.selectedReportContact}
              onSelectReportContact={controller.setSelectedReportContact}
              reportSeverityFilter={controller.reportSeverityFilter}
              onChangeReportSeverityFilter={controller.setReportSeverityFilter}
            />
          </div>
        ) : (
          <div className="settings-animated" key={`settings-${viewAnimationKey}`}>
            <SettingsView />
          </div>
        )}

        <footer className="footer brand-footer">
          <div className="brand-footer-left">Dev by <strong>IA Infinity</strong></div>
          <div className="brand-footer-center">© 2026 Hilê – Fábrica de suplementos alimentares</div>
          <div className="brand-footer-right brand-footer-socials">
            <a href="https://www.facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook">
              <FaFacebookF />
            </a>
            <a href="https://x.com" target="_blank" rel="noreferrer" aria-label="Twitter">
              <FaXTwitter />
            </a>
            <a href="https://www.instagram.com/hileterceirizacao/" target="_blank" rel="noreferrer" aria-label="Instagram">
              <FaInstagram />
            </a>
            <a href="https://www.linkedin.com" target="_blank" rel="noreferrer" aria-label="LinkedIn">
              <FaLinkedinIn />
            </a>
          </div>
        </footer>
      </main>

      {showConfirmModal && activeView === "dashboard" ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirmOverviewTitle">
          <div className="modal-card">
            <h3 id="confirmOverviewTitle">Executar overview agora?</h3>
            <p>Vamos checar conexões, buscar conversas do dia, rodar análise e atualizar o relatório.</p>
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
    </div>
  );
}
