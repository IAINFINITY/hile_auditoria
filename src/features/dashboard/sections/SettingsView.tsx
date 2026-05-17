"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FiCheck, FiX } from "react-icons/fi";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface SettingsViewProps {
  currentUser: {
    name: string;
    email: string;
    role: string;
  };
  onUpdateProfile: (updates: { name?: string; role?: string }) => void;
}

const LS_PROFILE_NAME = "hile_settings_profile_name";
const LS_PROFILE_ROLE = "hile_settings_profile_role";
const LS_NOTIFY_REPORT = "hile_settings_notify_report";
const LS_NOTIFY_LOG = "hile_settings_notify_log";
const LS_NOTIFY_CLIENT = "hile_settings_notify_client";

function loadStr(key: string, fallback = ""): string {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function loadBool(key: string, fallback = true): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "true";
  } catch { return fallback; }
}
function saveStr(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}
function saveBool(key: string, value: boolean) {
  try { localStorage.setItem(key, value ? "true" : "false"); } catch { /* noop */ }
}

function passwordStrength(pw: string): { label: string; score: number; checks: { label: string; ok: boolean }[] } {
  const checks = [
    { label: "Mínimo 8 caracteres", ok: pw.length >= 8 },
    { label: "Letra maiúscula", ok: /[A-Z]/.test(pw) },
    { label: "Letra minúscula", ok: /[a-z]/.test(pw) },
    { label: "Número", ok: /\d/.test(pw) },
    { label: "Caractere especial", ok: /[^A-Za-z0-9]/.test(pw) },
  ];
  const score = checks.filter((c) => c.ok).length;
  const label = score <= 1 ? "Fraca" : score <= 3 ? "Média" : "Forte";
  return { label, score, checks };
}

export function SettingsView({ currentUser, onUpdateProfile }: SettingsViewProps) {
  const [profileName, setProfileName] = useState(() => loadStr(LS_PROFILE_NAME, currentUser.name));
  const [profileRole, setProfileRole] = useState(() => loadStr(LS_PROFILE_ROLE, currentUser.role));
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notifyReport, setNotifyReport] = useState(() => loadBool(LS_NOTIFY_REPORT, true));
  const [notifyLog, setNotifyLog] = useState(() => loadBool(LS_NOTIFY_LOG, true));
  const [notifyClient, setNotifyClient] = useState(() => loadBool(LS_NOTIFY_CLIENT, true));
  const [profileSaved, setProfileSaved] = useState(false);
  const [securitySaved, setSecuritySaved] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const strength = useMemo(() => passwordStrength(newPassword), [newPassword]);

  useEffect(() => {
    if (profileSaved) {
      const t = setTimeout(() => setProfileSaved(false), 2000);
      return () => clearTimeout(t);
    }
  }, [profileSaved]);

  useEffect(() => {
    if (securitySaved) {
      const t = setTimeout(() => setSecuritySaved(false), 2000);
      return () => clearTimeout(t);
    }
  }, [securitySaved]);

  useEffect(() => {
    if (prefsSaved) {
      const t = setTimeout(() => setPrefsSaved(false), 2000);
      return () => clearTimeout(t);
    }
  }, [prefsSaved]);

  const handleSaveProfile = useCallback(async () => {
    const { error } = await supabaseBrowser.auth.updateUser({
      data: { name: profileName, role: profileRole },
    });
    if (error) return;
    saveStr(LS_PROFILE_NAME, profileName);
    saveStr(LS_PROFILE_ROLE, profileRole);
    onUpdateProfile({ name: profileName, role: profileRole });
    setProfileSaved(true);
  }, [profileName, profileRole, onUpdateProfile]);

  const handleSaveSecurity = useCallback(async () => {
    if (!currentPassword || !newPassword || !confirmPassword) return;
    if (newPassword !== confirmPassword) return;
    if (strength.score < 1) return;
    const { error } = await supabaseBrowser.auth.updateUser({ password: newPassword });
    if (error) return;
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSecuritySaved(true);
  }, [currentPassword, newPassword, confirmPassword, strength]);

  const handleSavePrefs = useCallback(() => {
    saveBool(LS_NOTIFY_REPORT, notifyReport);
    saveBool(LS_NOTIFY_LOG, notifyLog);
    saveBool(LS_NOTIFY_CLIENT, notifyClient);
    setPrefsSaved(true);
  }, [notifyReport, notifyLog, notifyClient]);

  const securityValid = currentPassword.length > 0 && newPassword.length > 0 && confirmPassword.length > 0 && newPassword === confirmPassword && strength.score >= 1;

  return (
    <div className="settings-shell">
      <div className="section-inner">
        <div className="section-header">
          <span className="section-num">01</span>
          <div className="section-title">
            <h2>Configurações</h2>
            <p>Ajustes de perfil, segurança e preferências do dashboard.</p>
          </div>
        </div>
      </div>

      <section className="settings-card" id="settings-profile">
        <div className="settings-card-head">Perfil</div>
        <div className="settings-card-body" style={{ gap: 18 }}>
          <div>
            <p style={{ margin: 0, fontSize: "var(--fs-small)", color: "var(--muted)", lineHeight: 1.55 }}>
              Altere seu nome de perfil, visualize seu e-mail e informe seu cargo.
            </p>
          </div>
          <hr className="gap-divider" style={{ margin: 0 }} />
          <div className="settings-field">
            <label>Nome de perfil</label>
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Seu nome"
            />
          </div>
          <div className="settings-field">
            <label>Email</label>
            <input type="email" value={currentUser.email} readOnly tabIndex={-1} />
          </div>
          <div className="settings-field">
            <label>Cargo</label>
            <select
              value={profileRole}
              onChange={(e) => setProfileRole(e.target.value)}
              className="settings-select"
            >
              <option value="Administrador">Administrador</option>
            </select>
          </div>
          <div className="settings-save-row">
            <button className="btn btn-primary btn-sm" onClick={handleSaveProfile}>
              Salvar alterações
            </button>
            {profileSaved && <span className="save-feedback">Salvo ✓</span>}
          </div>
        </div>
      </section>

      <section className="settings-card" id="settings-security">
        <div className="settings-card-head">Segurança</div>
        <div className="settings-card-body" style={{ gap: 18 }}>
          <div>
            <p style={{ margin: 0, fontSize: "var(--fs-small)", color: "var(--muted)", lineHeight: 1.55 }}>
              Altere sua senha. Insira a senha atual e depois a nova senha.
            </p>
          </div>
          <hr className="gap-divider" style={{ margin: 0 }} />
          <div className="settings-field">
            <label>Senha atual</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div className="settings-field">
            <label>Nova senha</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
            <span style={{ fontSize: "var(--fs-tiny)", color: "var(--muted)", marginTop: 2 }}>
              Insira uma senha forte
            </span>
          </div>
          {newPassword.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              <div className="strength-bar">
                <div className="strength-track">
                  <div
                    className="strength-fill"
                    style={{
                      width: `${(strength.score / 5) * 100}%`,
                      background: strength.label === "Forte" ? "var(--low)" : strength.label === "Média" ? "var(--high)" : "var(--critical)",
                    }}
                  />
                </div>
                <span
                  className="strength-label"
                  style={{ color: strength.label === "Forte" ? "var(--low)" : strength.label === "Média" ? "var(--high)" : "var(--critical)" }}
                >
                  {strength.label}
                </span>
              </div>
              <div className="strength-checks">
                {strength.checks.map((check) => (
                  <div className="strength-check" key={check.label}>
                    {check.ok ? (
                      <FiCheck style={{ color: "var(--low)" }} />
                    ) : (
                      <FiX style={{ color: "var(--critical)" }} />
                    )}
                    <span>{check.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="settings-field">
            <label>Confirmar nova senha</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repita a nova senha"
            />
          </div>
          <div className="settings-save-row">
            <button className="btn btn-primary btn-sm" onClick={handleSaveSecurity} disabled={!securityValid}>
              Salvar alterações
            </button>
            {securitySaved && <span className="save-feedback">Salvo ✓</span>}
          </div>
        </div>
      </section>

      <section className="settings-card" id="settings-preferences">
        <div className="settings-card-head">Preferências</div>
        <div className="settings-card-body" style={{ gap: 18 }}>
          <div>
            <p style={{ margin: 0, fontSize: "var(--fs-small)", color: "var(--muted)", lineHeight: 1.55 }}>
              Ative ou desative notificações do sistema.
            </p>
          </div>
          <hr className="gap-divider" style={{ margin: 0 }} />
          <div className="settings-toggle-item">
            <span className="settings-toggle-dot" style={{ background: "var(--azul)" }} />
            <div className="settings-toggle-content">
              <span className="settings-toggle-title">Relatório executado / finalizado</span>
              <span className="settings-toggle-desc">Notificação quando um relatório de auditoria é concluído</span>
            </div>
            <span
              className={`settings-toggle-pill${notifyReport ? " on" : ""}`}
              onClick={() => setNotifyReport((v) => !v)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setNotifyReport((v) => !v); }}
              role="switch"
              aria-checked={notifyReport}
              tabIndex={0}
            />
          </div>
          <div className="settings-toggle-item">
            <span className="settings-toggle-dot" style={{ background: "var(--azul)" }} />
            <div className="settings-toggle-content">
              <span className="settings-toggle-title">Log novo</span>
              <span className="settings-toggle-desc">Alerta quando uma nova execução é registrada no sistema</span>
            </div>
            <span
              className={`settings-toggle-pill${notifyLog ? " on" : ""}`}
              onClick={() => setNotifyLog((v) => !v)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setNotifyLog((v) => !v); }}
              role="switch"
              aria-checked={notifyLog}
              tabIndex={0}
            />
          </div>
          <div className="settings-toggle-item">
            <span className="settings-toggle-dot" style={{ background: "var(--azul)" }} />
            <div className="settings-toggle-content">
              <span className="settings-toggle-title">Cliente novo</span>
              <span className="settings-toggle-desc">Notificação quando um novo cliente é identificado na base</span>
            </div>
            <span
              className={`settings-toggle-pill${notifyClient ? " on" : ""}`}
              onClick={() => setNotifyClient((v) => !v)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setNotifyClient((v) => !v); }}
              role="switch"
              aria-checked={notifyClient}
              tabIndex={0}
            />
          </div>
          <div className="settings-save-row">
            <button className="btn btn-primary btn-sm" onClick={handleSavePrefs}>
              Salvar alterações
            </button>
            {prefsSaved && <span className="save-feedback">Salvo ✓</span>}
          </div>
        </div>
      </section>
    </div>
  );
}
