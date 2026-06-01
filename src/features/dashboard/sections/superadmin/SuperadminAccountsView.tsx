"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";

interface AllowedUserItem {
  id: string;
  email: string;
  displayName: string | null;
  role: "superadmin" | "admin";
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

interface SuperadminAccountsViewProps {
  currentUserEmail: string;
  currentUserRole: string;
}

const INITIAL_PASSWORD_MAX_LENGTH = 64;
const INITIAL_PASSWORD_COUNTER_WARN_AT = 12;
type AccountsCache = { items: AllowedUserItem[]; revision: string | null };
let superadminAccountsCache: AccountsCache | null = null;

function normalizeEmail(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
}

function toRoleLabel(role: "superadmin" | "admin"): string {
  return role === "superadmin" ? "Super Admin" : "Admin";
}

function toInitials(name: string): string {
  const clean = String(name || "").trim();
  if (!clean) return "U";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function sortAllowedUsers(items: AllowedUserItem[]): AllowedUserItem[] {
  return [...items].sort((a, b) => {
    if (a.role !== b.role) return a.role === "superadmin" ? -1 : 1;
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
}

export function SuperadminAccountsView({ currentUserEmail, currentUserRole }: SuperadminAccountsViewProps) {
  const isSuperadmin = String(currentUserRole || "")
    .trim()
    .toLowerCase()
    .includes("superadmin");

  const [items, setItems] = useState<AllowedUserItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "superadmin" | "admin">("all");
  const [isCreating, setIsCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [showCreateConfirmModal, setShowCreateConfirmModal] = useState(false);
  const [pendingToggleUser, setPendingToggleUser] = useState<AllowedUserItem | null>(null);

  const loadUsers = useCallback(async (options?: { force?: boolean; silent?: boolean }) => {
    if (!isSuperadmin) return;
    const force = Boolean(options?.force);
    const silent = Boolean(options?.silent);

    if (!force && superadminAccountsCache) {
      setItems(superadminAccountsCache.items);
      return;
    }

    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const response = await fetch("/api/auth/users", { method: "GET", cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        items?: AllowedUserItem[];
        revision?: string;
        message?: string;
      };
      if (!response.ok) {
        if (!silent) {
          setItems([]);
          setError(payload.message || "Não foi possível carregar as contas.");
        }
        return;
      }
      const list = Array.isArray(payload.items) ? payload.items : [];
      setItems(list);
      superadminAccountsCache = { items: list, revision: payload.revision || null };
    } catch {
      if (!silent) {
        setItems([]);
        setError("Falha de conexão ao carregar contas.");
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [isSuperadmin]);

  const refreshIfChanged = useCallback(async () => {
    if (!isSuperadmin || !superadminAccountsCache) return;
    try {
      const response = await fetch("/api/auth/users?meta=1", { method: "GET", cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { revision?: string };
      if (!response.ok || !payload.revision) return;
      if (payload.revision !== superadminAccountsCache.revision) {
        await loadUsers({ force: true, silent: true });
      }
    } catch {
      // noop
    }
  }, [isSuperadmin, loadUsers]);

  useEffect(() => {
    if (!isSuperadmin) return;
    const timer = window.setTimeout(() => {
      if (superadminAccountsCache) {
        setItems(superadminAccountsCache.items);
        void refreshIfChanged();
        return;
      }
      void loadUsers({ force: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isSuperadmin, loadUsers, refreshIfChanged]);

  const summary = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let admins = 0;
    let superadmins = 0;
    for (const item of items) {
      if (item.active) active += 1;
      else inactive += 1;
      if (item.role === "superadmin") superadmins += 1;
      else admins += 1;
    }
    return { total: items.length, active, inactive, admins, superadmins };
  }, [items]);

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (statusFilter === "active" && !item.active) return false;
      if (statusFilter === "inactive" && item.active) return false;
      if (roleFilter !== "all" && item.role !== roleFilter) return false;
      if (!needle) return true;
      return (
        item.email.toLowerCase().includes(needle) ||
        String(item.displayName || "").toLowerCase().includes(needle) ||
        toRoleLabel(item.role).toLowerCase().includes(needle)
      );
    });

    return sortAllowedUsers(filtered);
  }, [items, roleFilter, search, statusFilter]);

  const canCreate = normalizeEmail(newEmail).length > 0 && newPassword.length >= 8;
  const remainingInitialPassword = INITIAL_PASSWORD_MAX_LENGTH - newPassword.length;

  async function performCreate() {
    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizeEmail(newEmail),
          password: newPassword,
          displayName: newName.trim() || null,
          role: "admin",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; item?: AllowedUserItem };
      if (!response.ok) {
        setError(payload.message || "Não foi possível criar a conta.");
        return;
      }

      if (payload.item) {
        const nextItems = sortAllowedUsers([
          ...items.filter((existingItem) => existingItem.id !== payload.item?.id && normalizeEmail(existingItem.email) !== normalizeEmail(payload.item?.email || "")),
          payload.item,
        ]);
        setItems(nextItems);
        superadminAccountsCache = { items: nextItems, revision: superadminAccountsCache?.revision || null };
      }

      setNewEmail("");
      setNewName("");
      setNewPassword("");
      setShowInitialPassword(false);
      setSearch("");
      setStatusFilter("all");
      setRoleFilter("all");
      void loadUsers({ force: true, silent: true });
    } catch {
      setError("Falha de conexão ao criar conta.");
    } finally {
      setIsCreating(false);
    }
  }

  function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate || isCreating) return;
    setShowCreateConfirmModal(true);
  }

  async function handleToggleActive(item: AllowedUserItem) {
    if (updatingId) return;
    setUpdatingId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/auth/users/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !item.active }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(payload.message || "Não foi possível atualizar a conta.");
        return;
      }
      await loadUsers({ force: true });
    } catch {
      setError("Falha de conexão ao atualizar conta.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleConfirmCreate() {
    setShowCreateConfirmModal(false);
    await performCreate();
  }

  async function handleConfirmToggle() {
    if (!pendingToggleUser) return;
    const user = pendingToggleUser;
    setPendingToggleUser(null);
    await handleToggleActive(user);
  }

  if (!isSuperadmin) {
    return (
      <div className="settings-shell">
        <div className="section-inner">
          <div className="section-header">
            <div className="section-title">
              <h2>Superadmin</h2>
              <p>Área restrita para gestão de contas administrativas.</p>
            </div>
          </div>
        </div>
        <section className="settings-card">
          <div className="settings-card-head">Contas</div>
          <div className="settings-card-body">
            <p className="accounts-admin-empty">Você não possui permissão para acessar esta área.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="settings-shell superadmin-shell">
      <div className="section-inner" id="superadmin-accounts">
        <div className="section-header">
          <div className="section-title">
            <h2>Superadmin</h2>
            <p>Gestão central das contas do sistema, com criação, status e histórico de acesso.</p>
          </div>
        </div>
      </div>

      <section className="settings-card">
        <div className="settings-card-head">Resumo de contas</div>
        <div className="settings-card-body superadmin-kpis">
          <article className="analysis-overall-mini-item">
            <span>Total</span>
            <strong>{summary.total}</strong>
          </article>
          <article className="analysis-overall-mini-item">
            <span>Ativas</span>
            <strong>{summary.active}</strong>
          </article>
          <article className="analysis-overall-mini-item">
            <span>Inativas</span>
            <strong>{summary.inactive}</strong>
          </article>
          <article className="analysis-overall-mini-item">
            <span>Superadmin</span>
            <strong>{summary.superadmins}</strong>
          </article>
          <article className="analysis-overall-mini-item">
            <span>Admin</span>
            <strong>{summary.admins}</strong>
          </article>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-head">Adicionar conta</div>
        <div className="settings-card-body accounts-admin-body">
          <form className="accounts-admin-form" onSubmit={handleCreate}>
            <div className="accounts-admin-grid">
              <div className="settings-field">
                <label>E-mail</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  placeholder="admin@empresa.com"
                  autoComplete="off"
                />
              </div>
              <div className="settings-field">
                <label>Nome</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Nome da pessoa"
                  autoComplete="off"
                />
              </div>
              <div className="settings-field">
                <label>Senha inicial</label>
                <div className="accounts-password-wrap">
                  <input
                    type={showInitialPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    minLength={8}
                    maxLength={INITIAL_PASSWORD_MAX_LENGTH}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="accounts-password-visibility-btn"
                    onClick={() => setShowInitialPassword((value) => !value)}
                    aria-label={showInitialPassword ? "Ocultar senha" : "Mostrar senha"}
                    title={showInitialPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showInitialPassword ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="accounts-admin-form-footer">
              <div className="accounts-admin-password-meta">
                <span>Máximo de {INITIAL_PASSWORD_MAX_LENGTH} caracteres</span>
                {remainingInitialPassword <= INITIAL_PASSWORD_COUNTER_WARN_AT ? (
                  <span style={{ color: remainingInitialPassword <= 5 ? "var(--critical)" : "var(--muted)" }}>
                    {newPassword.length}/{INITIAL_PASSWORD_MAX_LENGTH}
                  </span>
                ) : null}
              </div>
              <div className="settings-save-row">
              <button type="submit" className="btn btn-primary btn-sm" disabled={!canCreate || isCreating}>
                {isCreating ? "Adicionando..." : "Adicionar conta"}
              </button>
              </div>
            </div>
          </form>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-head">Lista de contas</div>
        <div className="settings-card-body accounts-admin-body">
          <div className="accounts-filter-row superadmin-filters">
            <label>
              Buscar
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nome, e-mail ou cargo"
              />
            </label>
            <label>
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                <option value="all">Todos</option>
                <option value="active">Ativas</option>
                <option value="inactive">Inativas</option>
              </select>
            </label>
            <label>
              Cargo
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}>
                <option value="all">Todos</option>
                <option value="superadmin">Superadmin</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>

          {error ? <p className="accounts-admin-error">{error}</p> : null}

          {isLoading ? (
            <p className="accounts-admin-empty">Carregando contas...</p>
          ) : filteredItems.length === 0 ? (
            <p className="accounts-admin-empty">Nenhuma conta encontrada com os filtros atuais.</p>
          ) : (
            <div className="superadmin-table-wrap">
              <table className="superadmin-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>E-mail</th>
                    <th>Papel</th>
                    <th>Status</th>
                    <th>Criado em</th>
                    <th>Último login</th>
                    <th>Alterar</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const isSelf = normalizeEmail(item.email) === normalizeEmail(currentUserEmail);
                    const isProtectedSuperadmin = item.role === "superadmin";
                    const disableToggle = Boolean(updatingId) || isSelf || isProtectedSuperadmin;
                    const title = item.displayName || item.email.split("@")[0] || "Usuário";
                    const initials = toInitials(title);
                    return (
                      <tr key={item.id}>
                        <td>
                          <div className="superadmin-user-cell">
                            <span className="superadmin-user-avatar">{initials}</span>
                            <div className="superadmin-user-meta">
                              <strong>{title}</strong>
                            </div>
                          </div>
                        </td>
                        <td>{item.email}</td>
                        <td>
                          <span className={`superadmin-role-pill ${item.role === "superadmin" ? "role-superadmin" : "role-admin"}`}>
                            {toRoleLabel(item.role)}
                          </span>
                        </td>
                        <td>
                          <span className={`tag ${item.active ? "tag-ok" : "tag-warn"}`}>{item.active ? "Ativo" : "Inativo"}</span>
                        </td>
                        <td>{formatDateTime(item.createdAt)}</td>
                        <td>{formatDateTime(item.lastLoginAt) === "-" ? "Nunca" : formatDateTime(item.lastLoginAt)}</td>
                        <td>
                          {disableToggle ? (
                            <span className="superadmin-no-permission">Sem permissão</span>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={disableToggle}
                              onClick={() => setPendingToggleUser(item)}
                            >
                              {item.active ? "Desativar" : "Reativar"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {showCreateConfirmModal ? (
        <div className="modal-backdrop" role="presentation" onClick={() => (isCreating ? null : setShowCreateConfirmModal(false))}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar adição de conta" onClick={(event) => event.stopPropagation()}>
            <h3>Confirmar adição de conta</h3>
            <p>
              Deseja adicionar esta conta agora?
              <br />
              <strong>{normalizeEmail(newEmail)}</strong>
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-sm" onClick={() => setShowCreateConfirmModal(false)} disabled={isCreating}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleConfirmCreate()} disabled={isCreating}>
                {isCreating ? "Adicionando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingToggleUser ? (
        <div className="modal-backdrop" role="presentation" onClick={() => (updatingId ? null : setPendingToggleUser(null))}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar alteração de conta" onClick={(event) => event.stopPropagation()}>
            <h3>{pendingToggleUser.active ? "Confirmar desativação" : "Confirmar reativação"}</h3>
            <p>
              {pendingToggleUser.active
                ? "Deseja realmente desativar este usuário?"
                : "Deseja realmente reativar este usuário?"}
              <br />
              <strong>{pendingToggleUser.email}</strong>
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-sm" onClick={() => setPendingToggleUser(null)} disabled={Boolean(updatingId)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleConfirmToggle()} disabled={Boolean(updatingId)}>
                {updatingId ? "Processando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
