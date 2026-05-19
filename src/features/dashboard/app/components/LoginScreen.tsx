import type { FormEvent } from "react";
import Image from "next/image";
import { FiEye, FiEyeOff, FiLock, FiMail } from "react-icons/fi";
import { AppFooter } from "@/features/dashboard/sections/layout/AppFooter";

interface LoginScreenProps {
  email: string;
  password: string;
  showPassword: boolean;
  rememberMe: boolean;
  isAuthenticating: boolean;
  loginError: string;
  showForgotPasswordModal: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onRememberMeChange: (value: boolean) => void;
  onForgotPassword: () => void;
  onCloseForgotPasswordModal: () => void;
}

export function LoginScreen({
  email,
  password,
  showPassword,
  rememberMe,
  isAuthenticating,
  loginError,
  showForgotPasswordModal,
  onSubmit,
  onEmailChange,
  onPasswordChange,
  onTogglePassword,
  onRememberMeChange,
  onForgotPassword,
  onCloseForgotPasswordModal,
}: LoginScreenProps) {
  return (
    <div className="login-screen">
      <div className="login-blob login-blob-1" />
      <div className="login-blob login-blob-2" />
      <div className="login-blob login-blob-3" />

      <form className="login-card login-card-advanced" onSubmit={onSubmit}>
        <div className="login-card-header">
          <Image className="login-brand-logo" src="/logo_hile1.png" alt="Hil?" width={280} height={96} priority />
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
                onChange={(event) => onEmailChange(event.target.value)}
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
                onChange={(event) => onPasswordChange(event.target.value)}
                placeholder="Digite sua senha"
                disabled={isAuthenticating}
              />
              <button
                type="button"
                className="password-visibility-btn"
                onClick={onTogglePassword}
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
                onChange={(event) => onRememberMeChange(event.target.checked)}
                disabled={isAuthenticating}
              />
              <span>Lembrar de mim</span>
            </label>
            <button className="forgot-link" type="button" onClick={onForgotPassword} disabled={isAuthenticating}>
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
          <span className="secure-session-divider" aria-hidden="true">
            |
          </span>
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
              <button className="btn btn-primary btn-sm" onClick={onCloseForgotPasswordModal}>
                Entendi
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
