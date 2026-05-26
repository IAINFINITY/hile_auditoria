import { FiSearch } from "react-icons/fi";
import type { ClientPhase, Severity } from "../../../../../types";
import type { AccountStatus, ResponsibleFilter } from "./types";

interface AccountsFiltersCardProps {
  query: string;
  onQueryChange: (value: string) => void;
  statusFilter: "all" | AccountStatus;
  onStatusFilterChange: (value: "all" | AccountStatus) => void;
  labelFilter: string;
  onLabelFilterChange: (value: string) => void;
  labelsAvailable: string[];
  effectiveAnalysisFilter: "all" | "gaps_insights" | Severity;
  onAnalysisFilterChange: (value: "all" | "gaps_insights" | Severity) => void;
  analysisFilterOptions: Array<{ value: "all" | "gaps_insights" | Severity; label: string }>;
  responsibleFilter: ResponsibleFilter;
  onResponsibleFilterChange: (value: ResponsibleFilter) => void;
  responsibleFilterLocked?: boolean;
  phaseFilter: "all" | ClientPhase;
  onPhaseFilterChange: (value: "all" | ClientPhase) => void;
  favoritesOnly: boolean;
  onFavoritesOnlyChange: (value: boolean) => void;
  pinnedOnly: boolean;
  onPinnedOnlyChange: (value: boolean) => void;
}

export function AccountsFiltersCard({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  labelFilter,
  onLabelFilterChange,
  labelsAvailable,
  effectiveAnalysisFilter,
  onAnalysisFilterChange,
  analysisFilterOptions,
  responsibleFilter,
  onResponsibleFilterChange,
  responsibleFilterLocked = false,
  phaseFilter,
  onPhaseFilterChange,
  favoritesOnly,
  onFavoritesOnlyChange,
  pinnedOnly,
  onPinnedOnlyChange,
}: AccountsFiltersCardProps) {
  return (
    <article className="settings-card" id="clients-filtros">
      <div className="settings-card-head">Filtros</div>
      <div className="settings-card-body accounts-filters">
        <div className="accounts-search">
          <FiSearch aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar por nome, telefone, CNPJ ou empresa"
          />
        </div>

        <div className="accounts-filter-row">
          <label>
            Status
            <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as "all" | AccountStatus)}>
              <option value="all">Todos</option>
              <option value="entrada">Entrada</option>
              <option value="remarketing">Remarketing</option>
              <option value="atencao">AtenÃ§Ã£o</option>
              <option value="resolvido">Fora da IA</option>
            </select>
          </label>

          <label>
            Etiqueta
            <select value={labelFilter} onChange={(event) => onLabelFilterChange(event.target.value)}>
              <option value="all">Todas</option>
              {labelsAvailable.map((label) => (
                <option value={label} key={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Gaps/Insights
            <select
              value={effectiveAnalysisFilter}
              onChange={(event) => onAnalysisFilterChange(event.target.value as "all" | "gaps_insights" | Severity)}
            >
              {analysisFilterOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            ResponsÃ¡vel
            <select value={responsibleFilter} disabled={responsibleFilterLocked} onChange={(event) => onResponsibleFilterChange(event.target.value as ResponsibleFilter)}>
              <option value="all">Todos</option>
              <option value="ia">IA</option>
              <option value="suellen">Comercial Suellen</option>
              <option value="samuel">Comercial Samuel</option>
            </select>
          </label>

          <label>
            Fase do cliente
            <select value={phaseFilter} onChange={(event) => onPhaseFilterChange(event.target.value as "all" | ClientPhase)}>
              <option value="all">Todas</option>
              <option value="inicial">Inicial</option>
              <option value="intermediario">IntermediÃ¡rio</option>
              <option value="avancado">AvanÃ§ado</option>
            </select>
          </label>
        </div>

        <div className="accounts-switch-row">
          <label className="accounts-switch">
            <input type="checkbox" checked={favoritesOnly} onChange={(event) => onFavoritesOnlyChange(event.target.checked)} />
            Apenas favoritos
          </label>

          <label className="accounts-switch">
            <input type="checkbox" checked={pinnedOnly} onChange={(event) => onPinnedOnlyChange(event.target.checked)} />
            Apenas fixados
          </label>
        </div>
      </div>
    </article>
  );
}



