import { FiMapPin, FiStar } from "react-icons/fi";
import type { ClientRecordItem } from "../../../../../types";
import { labelClass } from "../../report/utils";
import {
  clientPhaseClass,
  clientPhaseLabel,
  responsibleLabel,
  severityClass,
  severityLabel,
  statusLabel,
} from "./helpers";
import type { AccountStatus } from "./types";

interface AccountsKanbanCardProps {
  shouldDimKanban: boolean;
  loading: boolean;
  errorMessage: string;
  filteredRecords: ClientRecordItem[];
  hasActiveFilters: boolean;
  filteredColsClass: string;
  visibleStatuses: AccountStatus[];
  recordsByStatus: Record<AccountStatus, ClientRecordItem[]>;
  favoritePhones: string[];
  pinnedPhones: string[];
  onToggleFavorite: (phonePk: string) => void;
  onTogglePinned: (phonePk: string) => void;
  onSelectRecord: (record: ClientRecordItem) => void;
}

export function AccountsKanbanCard({
  shouldDimKanban,
  loading,
  errorMessage,
  filteredRecords,
  hasActiveFilters,
  filteredColsClass,
  visibleStatuses,
  recordsByStatus,
  favoritePhones,
  pinnedPhones,
  onToggleFavorite,
  onTogglePinned,
  onSelectRecord,
}: AccountsKanbanCardProps) {
  return (
    <article className={`settings-card ${shouldDimKanban ? "data-dim" : ""}`} id="clients-kanban">
      <div className="settings-card-head">Kanban - {filteredRecords.length} cliente(s)</div>
      <div className="settings-card-body accounts-list-wrap">
        {loading ? <p className="empty-state">Carregando clientes do banco...</p> : null}
        {!loading && errorMessage ? <p className="empty-state">{errorMessage}</p> : null}
        {!loading && !errorMessage && filteredRecords.length === 0 ? (
          <p className="empty-state">Nenhum cliente encontrado com os filtros atuais.</p>
        ) : null}

        {!loading && !errorMessage && filteredRecords.length > 0 ? (
          <div className={`accounts-kanban ${hasActiveFilters ? `is-filtered ${filteredColsClass}` : ""}`}>
            {visibleStatuses.map((status) => {
              const list = recordsByStatus[status];
              return (
                <section className="accounts-kanban-col" key={status}>
                  <header className="accounts-kanban-col-head">
                    <span>{statusLabel(status)}</span>
                    <span className={`accounts-kanban-badge status-${status}`}>{list.length}</span>
                  </header>
                  <div className="accounts-kanban-col-body">
                    {list.length === 0 ? (
                      <p className="accounts-kanban-empty">Nenhum cliente nesta coluna.</p>
                    ) : (
                      list.map((record) => {
                        const isFavorite = favoritePhones.includes(record.phonePk);
                        const isPinned = pinnedPhones.includes(record.phonePk);
                        return (
                          <article
                            className={`account-card compact ${isFavorite ? "is-favorite" : ""} ${isPinned ? "is-pinned" : ""}`}
                            key={record.phonePk}
                          >
                            <div className="account-card-head">
                              <div>
                                <h3>{record.contactName || "Contato sem nome"}</h3>
                                <p className="k-card-phone">{record.phonePk || "não informado"}</p>
                                <div className="account-highlight-tags">
                                  {isPinned ? <span className="account-highlight-tag pinned">Fixado</span> : null}
                                  {isFavorite ? <span className="account-highlight-tag favorite">Favorito</span> : null}
                                </div>
                              </div>
                              <span className={`sev-dot ${severityClass(record.severity)}`} title={severityLabel(record.severity)} />
                            </div>

                            <p className="k-card-meta">
                              <span>{severityLabel(record.severity)}</span>
                              <span className="k-card-meta-sep">·</span>
                              <span className={`client-phase-badge ${clientPhaseClass(record.clientPhase)}`}>
                                {clientPhaseLabel(record.clientPhase)}
                              </span>
                              <span className="k-card-meta-sep">·</span>
                              <span>{responsibleLabel(record.responsibleBucket || record.responsibleLabel || "ia")}</span>
                              <span className="k-card-meta-sep">·</span>
                              <span>{record.companyName || "Empresa não informada"}</span>
                              {record.status === "resolvido" && record.finalizationActor ? (
                                <>
                                  <span className="k-card-meta-sep">·</span>
                                  <span>Finalizada por {record.finalizationActor}</span>
                                </>
                              ) : null}
                            </p>

                            <div className="account-tags">
                              {record.labels.length > 0 ? (
                                record.labels.slice(0, 3).map((label) => (
                                  <span className={labelClass(label)} key={`${record.phonePk}-${label}`}>
                                    {label}
                                  </span>
                                ))
                              ) : (
                                <span className="tag">sem etiqueta</span>
                              )}
                            </div>

                            <div className="account-compact-actions">
                              <button
                                type="button"
                                className={`icon-toggle ${isFavorite ? "on" : ""}`}
                                onClick={() => onToggleFavorite(record.phonePk)}
                                title={isFavorite ? "Remover favorito" : "Favoritar"}
                                aria-label={isFavorite ? "Remover favorito" : "Favoritar"}
                              >
                                <FiStar />
                              </button>
                              <button
                                type="button"
                                className={`icon-toggle ${isPinned ? "on" : ""}`}
                                onClick={() => onTogglePinned(record.phonePk)}
                                title={isPinned ? "Desafixar" : "Fixar"}
                                aria-label={isPinned ? "Desafixar" : "Fixar"}
                              >
                                <FiMapPin />
                              </button>
                              <button className="btn btn-sm btn-primary" onClick={() => onSelectRecord(record)}>
                                Detalhes
                              </button>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}
