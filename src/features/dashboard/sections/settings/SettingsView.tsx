"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FiCheck, FiX } from "react-icons/fi";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { HileCardGrid, HileInlineInsight, HileKpiCard, HileSectionShell, HileSurfaceCard } from "../../shared/ui/HilePrimitives";

interface SettingsViewProps {
  currentUser: {
    name: string;
    email: string;
    role: string;
  };
  onUpdateProfile: (updates: { name?: string; role?: string }) => void;
}

const LS_PROFILE_NAME = "hile_settings_profile_name";
const LS_NOTIFY_REPORT = "hile_settings_notify_report";
const LS_NOTIFY_LOG = "hile_settings_notify_log";
const LS_NOTIFY_CLIENT = "hile_settings_notify_client";
const PASSWORD_MAX_LENGTH = 64;
const PASSWORD_COUNTER_WARN_AT = 12;

function loadStr(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function loadBool(key: string, fallback = true): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function saveStr(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // noop
  }
}

function saveBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // noop
  }
}

function normalizeEmail(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function passwordStrength(password: string): {
  label: string;
  score: number;
  checks: { label: string; ok: boolean }[];
} {
  const checks = [
    { label: "Mínimo 8 caracteres", ok: password.length >= 8 },
    { label: "Letra maiúscula", ok: /[A-Z]/.test(password) },
    { label: "Letra minúscula", ok: /[a-z]/.test(password) },
    { label: "Número", ok: /\d/.test(password) },
    { label: "Caractere especial", ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const score = checks.filter((item) => item.ok).length;
  const label = score <= 1 ? "Fraca" : score <= 3 ? "Média" : "Forte";
  return { label, score, checks };
}

export function SettingsView({ currentUser, onUpdateProfile }: SettingsViewProps) {
  const userStorageSuffix = useMemo(() => normalizeEmail(currentUser.email), [currentUser.email]);
  const profileNameKey = `${LS_PROFILE_NAME}:${userStorageSuffix}`;
  const notifyReportKey = `${LS_NOTIFY_REPORT}:${userStorageSuffix}`;
  const notifyLogKey = `${LS_NOTIFY_LOG}:${userStorageSuffix}`;
  const notifyClientKey = `${LS_NOTIFY_CLIENT}:${userStorageSuffix}`;

  const [profileName, setProfileName] = useState(() => loadStr(profileNameKey, currentUser.name));
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notifyReport, setNotifyReport] = useState(() => loadBool(notifyReportKey, true));
  const [notifyLog, setNotifyLog] = useState(() => loadBool(notifyLogKey, true));
  const [notifyClient, setNotifyClient] = useState(() => loadBool(notifyClientKey, true));
  const [profileSaved, setProfileSaved] = useState(false);
  const [securitySaved, setSecuritySaved] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const strength = useMemo(() => passwordStrength(newPassword), [newPassword]);

  useEffect(() => {
    if (!profileSaved) return;
    const timer = setTimeout(() => setProfileSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [profileSaved]);

  useEffect(() => {
    if (!securitySaved) return;
    const timer = setTimeout(() => setSecuritySaved(false), 2000);
    return () => clearTimeout(timer);
  }, [securitySaved]);

  useEffect(() => {
    if (!prefsSaved) return;
    const timer = setTimeout(() => setPrefsSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [prefsSaved]);

  const handleSaveProfile = useCallback(async () => {
    const { error } = await supabaseBrowser.auth.updateUser({
      data: { name: profileName },
    });
    if (error) return;
    saveStr(profileNameKey, profileName);
    onUpdateProfile({ name: profileName });
    setProfileSaved(true);
  }, [onUpdateProfile, profileName, profileNameKey]);

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
  }, [confirmPassword, currentPassword, newPassword, strength.score]);

  const handleSavePrefs = useCallback(() => {
    saveBool(notifyReportKey, notifyReport);
    saveBool(notifyLogKey, notifyLog);
    saveBool(notifyClientKey, notifyClient);
    setPrefsSaved(true);
  }, [notifyClient, notifyClientKey, notifyLog, notifyLogKey, notifyReport, notifyReportKey]);

  const securityValid =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    newPassword === confirmPassword &&
    strength.score >= 1;

  const remainingCurrent = PASSWORD_MAX_LENGTH - currentPassword.length;
  const remainingNew = PASSWORD_MAX_LENGTH - newPassword.length;
  const remainingConfirm = PASSWORD_MAX_LENGTH - confirmPassword.length;

  return (
    <section className="settings-shell">
      <div className="section-inner">
        <HileSectionShell
          eyebrow="01"
          title="Configurações"
          description="Ajustes de perfil, segurança e preferências do dashboard."
        >
          <div className="hile-section-stack">
            <HileCardGrid cols={3}>
              <HileKpiCard label="Usuário" value={currentUser.name} hint={currentUser.email} tone="accent" accent="accent" />
              <HileKpiCard label="Cargo" value={currentUser.role} hint="Permissão atual da conta" />
              <HileKpiCard label="Preferências" value={[notifyReport, notifyLog, notifyClient].filter(Boolean).length} hint="Notificações ativas" />
            </HileCardGrid>

            <HileSurfaceCard title="Perfil" description="Altere seu nome de exibição e confira os dados da conta.">
              <div className="hile-section-stack">
                <div className="settings-field">
                  <label>Nome de perfil</label>
                  <input type="text" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Seu nome" />
                </div>
                <div className="settings-field">
                  <label>E-mail</label>
                  <input type="email" value={currentUser.email} readOnly tabIndex={-1} />
                </div>
                <div className="settings-field">
                  <label>Cargo</label>
                  <input type="text" value={currentUser.role} readOnly tabIndex={-1} />
                </div>
                <div className="settings-save-row">
                  <button className="btn btn-primary btn-sm" onClick={handleSaveProfile}>Salvar alterações</button>
                  {profileSaved ? <span className="save-feedback">Salvo</span> : null}
                </div>
              </div>
            </HileSurfaceCard>

            <HileSurfaceCard title="Segurança" description="Atualize sua senha e acompanhe a força da nova credencial." tone="soft">
              <div className="hile-section-stack">
                <div className="settings-field">
                  <label>Senha atual</label>
                  <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="********" maxLength={PASSWORD_MAX_LENGTH} />
                  {remainingCurrent <= PASSWORD_COUNTER_WARN_AT ? (
                    <span style={{ fontSize: "var(--fs-tiny)", color: remainingCurrent <= 5 ? "var(--critical)" : "var(--muted)" }}>
                      {currentPassword.length}/{PASSWORD_MAX_LENGTH}
                    </span>
                  ) : null}
                </div>

                <div className="settings-field">
                  <label>Nova senha</label>
                  <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Mínimo 8 caracteres" maxLength={PASSWORD_MAX_LENGTH} />
                  <span style={{ fontSize: "var(--fs-tiny)", color: "var(--muted)", marginTop: 2 }}>
                    Insira uma senha forte (máximo de {PASSWORD_MAX_LENGTH} caracteres)
                  </span>
                  {remainingNew <= PASSWORD_COUNTER_WARN_AT ? (
                    <span style={{ fontSize: "var(--fs-tiny)", color: remainingNew <= 5 ? "var(--critical)" : "var(--muted)" }}>
                      {newPassword.length}/{PASSWORD_MAX_LENGTH}
                    </span>
                  ) : null}
                </div>

                {newPassword.length > 0 ? (
                  <div className="hile-section-stack">
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
                      <span className="strength-label" style={{ color: strength.label === "Forte" ? "var(--low)" : strength.label === "Média" ? "var(--high)" : "var(--critical)" }}>
                        {strength.label}
                      </span>
                    </div>

                    <div className="strength-checks">
                      {strength.checks.map((check) => (
                        <div className="strength-check" key={check.label}>
                          {check.ok ? <FiCheck style={{ color: "var(--low)" }} /> : <FiX style={{ color: "var(--critical)" }} />}
                          <span>{check.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="settings-field">
                  <label>Confirmar nova senha</label>
                  <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repita a nova senha" maxLength={PASSWORD_MAX_LENGTH} />
                  {remainingConfirm <= PASSWORD_COUNTER_WARN_AT ? (
                    <span style={{ fontSize: "var(--fs-tiny)", color: remainingConfirm <= 5 ? "var(--critical)" : "var(--muted)" }}>
                      {confirmPassword.length}/{PASSWORD_MAX_LENGTH}
                    </span>
                  ) : null}
                </div>

                <div className="settings-save-row">
                  <button className="btn btn-primary btn-sm" onClick={handleSaveSecurity} disabled={!securityValid}>Salvar alterações</button>
                  {securitySaved ? <span className="save-feedback">Salvo</span> : null}
                </div>
              </div>
            </HileSurfaceCard>

            <HileSurfaceCard title="Preferências" description="Ative ou desative notificações do sistema." tone="soft">
              <div className="hile-section-stack">
                <HileInlineInsight title="Leitura rápida">As preferências abaixo ficam salvas por usuário no navegador atual.</HileInlineInsight>

                <div className="settings-toggle-item">
                  <span className="settings-toggle-dot" style={{ background: "var(--azul)" }} />
                  <div className="settings-toggle-content">
                    <span className="settings-toggle-title">Relatório executado/finalizado</span>
                    <span className="settings-toggle-desc">Notificação quando um relatório de auditoria é concluído</span>
                  </div>
                  <span className={`settings-toggle-pill${notifyReport ? " on" : ""}`} onClick={() => setNotifyReport((value) => !value)} onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setNotifyReport((value) => !value);
                  }} role="switch" aria-checked={notifyReport} tabIndex={0} />
                </div>

                <div className="settings-toggle-item">
                  <span className="settings-toggle-dot" style={{ background: "var(--azul)" }} />
                  <div className="settings-toggle-content">
                    <span className="settings-toggle-title">Log novo</span>
                    <span className="settings-toggle-desc">Alerta quando uma nova execução é registrada no sistema</span>
                  </div>
                  <span className={`settings-toggle-pill${notifyLog ? " on" : ""}`} onClick={() => setNotifyLog((value) => !value)} onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setNotifyLog((value) => !value);
                  }} role="switch" aria-checked={notifyLog} tabIndex={0} />
                </div>

                <div className="settings-toggle-item">
                  <span className="settings-toggle-dot" style={{ background: "var(--azul)" }} />
                  <div className="settings-toggle-content">
                    <span className="settings-toggle-title">Cliente novo</span>
                    <span className="settings-toggle-desc">Notificação quando um novo cliente é identificado na base</span>
                  </div>
                  <span className={`settings-toggle-pill${notifyClient ? " on" : ""}`} onClick={() => setNotifyClient((value) => !value)} onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setNotifyClient((value) => !value);
                  }} role="switch" aria-checked={notifyClient} tabIndex={0} />
                </div>

                <div className="settings-save-row">
                  <button className="btn btn-primary btn-sm" onClick={handleSavePrefs}>Salvar alterações</button>
                  {prefsSaved ? <span className="save-feedback">Salvo</span> : null}
                </div>
              </div>
            </HileSurfaceCard>
          </div>
        </HileSectionShell>
      </div>
    </section>
  );
}



