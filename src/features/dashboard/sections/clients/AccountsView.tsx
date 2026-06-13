import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import type { ClientPhase, ClientRecordItem, ClientsByDateResponse, Severity } from "../../../../types";
import { HileCardGrid, HileKpiCard, HilePill, HilePillRow, HileSectionShell, HileSurfaceCard } from "../../shared/ui/HilePrimitives";
import { AccountDetailModal } from "./accounts/AccountDetailModal";
import { AccountsFiltersCard } from "./accounts/AccountsFiltersCard";
import { AccountsKanbanCard } from "./accounts/AccountsKanbanCard";
import { dateKeyNowFortaleza, mapStatus, normalizeClientPhase, normalizeFilterText, normalizeResponsibleBucket } from "./accounts/helpers";
import type { AccountStatus, AccountsViewProps, ClientsScope, ResponsibleFilter } from "./accounts/types";
import { STATUS_ORDER } from "./accounts/types";

const CLIENTS_REVALIDATE_MS = 5 * 60 * 1000;
const CLIENTS_REVALIDATE_TODAY_MS = 60 * 1000;
const CLIENTS_CACHE_VERSION = "v8";

function ownerScopeLabel(scope: ResponsibleFilter | "all"): string {
  if (scope === "ia") return "IA";
  if (scope === "suellen") return "Comercial Suellen";
  if (scope === "samuel") return "Comercial Samuel";
  return "Todos";
}

export function AccountsView({
  selectedDate,
  knownRunId = null,
  refreshHint = null,
  ownerScope,
  onSetOwnerScope,
}: AccountsViewProps) {
  const [scope, setScope] = useState<ClientsScope>("day");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [analysisFilter, setAnalysisFilter] = useState<"all" | "gaps_insights" | Severity>("all");
  const [responsibleFilter, setResponsibleFilter] = useState<ResponsibleFilter>("all");
  const [phaseFilter, setPhaseFilter] = useState<"all" | ClientPhase>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [favoritePhones, setFavoritePhones] = useState<string[]>([]);
  const [pinnedPhones, setPinnedPhones] = useState<string[]>([]);
  const [records, setRecords] = useState<ClientRecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<ClientRecordItem | null>(null);
  const [scopeAnimationSeed, setScopeAnimationSeed] = useState(0);
  const handledRefreshHintRef = useRef<string | null>(null);
  const scopeKey = scope === "overall" ? `overall_${ownerScope}` : `${selectedDate}_${ownerScope}`;
  const cacheKey = `hile_clients_cache_${CLIENTS_CACHE_VERSION}_${scopeKey}`;
  const fetchMetaKey = `hile_clients_fetch_meta_${CLIENTS_CACHE_VERSION}_${scopeKey}`;

  useEffect(() => {
    let raf = 0;
    try {
      const savedFavorites = localStorage.getItem("hile_accounts_favorites");
      const savedPinned = localStorage.getItem("hile_accounts_pinned");
      const nextFavorites = savedFavorites ? JSON.parse(savedFavorites) : [];
      const nextPinned = savedPinned ? JSON.parse(savedPinned) : [];
      raf = requestAnimationFrame(() => {
        setFavoritePhones(Array.isArray(nextFavorites) ? nextFavorites : []);
        setPinnedPhones(Array.isArray(nextPinned) ? nextPinned : []);
      });
    } catch {
      raf = requestAnimationFrame(() => {
        setFavoritePhones([]);
        setPinnedPhones([]);
      });
    }
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    localStorage.setItem("hile_accounts_favorites", JSON.stringify(favoritePhones));
  }, [favoritePhones]);

  useEffect(() => {
    localStorage.setItem("hile_accounts_pinned", JSON.stringify(pinnedPhones));
  }, [pinnedPhones]);

  useEffect(() => {
    let raf = 0;
    try {
      const cachedRaw = localStorage.getItem(cacheKey);
      if (!cachedRaw) return;
      const cached = JSON.parse(cachedRaw) as {
        runId: string | null;
        records: ClientRecordItem[];
      };
      if (Array.isArray(cached.records)) {
        const nextRecords = cached.records;
        const nextRunId = cached.runId || null;
        raf = requestAnimationFrame(() => {
          setRecords(nextRecords);
          setRunId(nextRunId);
        });
      }
    } catch {
      // cache invalido
    }
    return () => cancelAnimationFrame(raf);
  }, [cacheKey]);

  useEffect(() => {
    let cancelled = false;
    const hasNewRefreshHint = Boolean(refreshHint) && refreshHint !== handledRefreshHintRef.current;
    if (hasNewRefreshHint && refreshHint) {
      handledRefreshHintRef.current = refreshHint;
    }

    const now = Date.now();
    const isToday = scope === "day" && selectedDate === dateKeyNowFortaleza();

    const cachedRaw = localStorage.getItem(cacheKey);
    const cachedPayload = cachedRaw
      ? (JSON.parse(cachedRaw) as { runId: string | null; records: ClientRecordItem[] })
      : null;
    const cachedRunId = cachedPayload?.runId || null;

    const fetchMetaRaw = sessionStorage.getItem(fetchMetaKey);
    const cachedMeta = fetchMetaRaw
      ? (JSON.parse(fetchMetaRaw) as { fetchedAt?: number; runId?: string | null })
      : null;
    const lastFetchedAt = Number(cachedMeta?.fetchedAt || 0);

    const freshnessWindow = isToday ? CLIENTS_REVALIDATE_TODAY_MS : CLIENTS_REVALIDATE_MS;
    const hasFreshCache = Boolean(cachedRaw) && now - lastFetchedAt < freshnessWindow;

    const runMismatch = scope === "day" && Boolean(knownRunId) && knownRunId !== cachedRunId;
    const shouldBypassCache = hasNewRefreshHint || runMismatch;

    if (!isToday && cachedRaw && hasFreshCache && !shouldBypassCache) {
      setLoading(false);
      setErrorMessage("");
      return () => {
        cancelled = true;
      };
    }

    if (hasFreshCache && !shouldBypassCache) {
      setLoading(false);
      setErrorMessage("");
      return () => {
        cancelled = true;
      };
    }

    setLoading(!cachedRaw);
    setErrorMessage("");

    const endpoint =
      scope === "overall"
        ? `/api/clients/overall?take=1000&owner=${encodeURIComponent(ownerScope)}`
        : `/api/clients?date=${encodeURIComponent(selectedDate)}&owner=${encodeURIComponent(ownerScope)}`;

    apiGet<ClientsByDateResponse>(endpoint)
      .then((payload) => {
        if (cancelled) return;

        const incomingRecords = Array.isArray(payload.items) ? payload.items : [];
        const incomingRunId = payload.runId || null;

        const currentSnapshot = JSON.stringify(cachedPayload?.records || []);
        const nextSnapshot = JSON.stringify(incomingRecords);
        const hasChanged = incomingRunId !== cachedRunId || currentSnapshot !== nextSnapshot;

        if (hasChanged) {
          setRecords(incomingRecords);
          setRunId(incomingRunId);
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              runId: incomingRunId,
              records: incomingRecords,
              updatedAt: new Date().toISOString(),
            }),
          );
        }

        setErrorMessage("");
        sessionStorage.setItem(fetchMetaKey, JSON.stringify({ fetchedAt: Date.now(), runId: incomingRunId }));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const cachedRecords = Array.isArray(cachedPayload?.records) ? cachedPayload.records : [];
        if (records.length === 0 && cachedRecords.length > 0) {
          setRecords(cachedRecords);
          setRunId(cachedPayload?.runId || null);
        }
        setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar clientes.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, fetchMetaKey, knownRunId, ownerScope, records.length, refreshHint, scope, selectedDate]);

  const effectiveResponsibleFilter: ResponsibleFilter = ownerScope === "all" ? responsibleFilter : ownerScope;
  const ownerLabel = ownerScopeLabel(ownerScope);

  const labelsAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const record of records) {
      for (const label of record.labels || []) {
        set.add(label);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [records]);

  const analysisFilterOptions = useMemo(() => {
    const hasGapsOrInsights = records.some(
      (record) => (record.gaps || []).length > 0 || (record.attentions || []).length > 0,
    );
    const hasCritical = records.some((record) => record.severity === "critical");
    const hasHigh = records.some((record) => record.severity === "high");
    const hasMedium = records.some((record) => record.severity === "medium");
    const hasLow = records.some((record) => record.severity === "low");
    const hasInfo = records.some((record) => record.severity === "info");

    const options: Array<{ value: "all" | "gaps_insights" | Severity; label: string }> = [{ value: "all", label: "Todos" }];
    if (hasGapsOrInsights) options.push({ value: "gaps_insights", label: "Gaps/insights" });
    if (hasCritical) options.push({ value: "critical", label: "Crítico" });
    if (hasHigh) options.push({ value: "high", label: "Alto" });
    if (hasMedium) options.push({ value: "medium", label: "Médio" });
    if (hasLow) options.push({ value: "low", label: "Baixo" });
    if (hasInfo) options.push({ value: "info", label: "Informativo" });

    return options;
  }, [records]);

  const availableAnalysisValues = useMemo(() => new Set(analysisFilterOptions.map((item) => item.value)), [analysisFilterOptions]);

  const effectiveAnalysisFilter: "all" | "gaps_insights" | Severity = availableAnalysisValues.has(analysisFilter)
    ? analysisFilter
    : "all";

  const filteredRecords = useMemo(() => {
    const q = normalizeFilterText(query);
    const list = records.filter((record) => {
      const byText =
        !q ||
        normalizeFilterText(record.contactName).includes(q) ||
        normalizeFilterText(record.phonePk).includes(q) ||
        normalizeFilterText(record.companyName).includes(q) ||
        normalizeFilterText(record.cnpj).includes(q);
      const status = mapStatus(record);
      const byStatus = statusFilter === "all" || status === statusFilter;
      const byLabel =
        labelFilter === "all" ||
        record.labels.some((label) => normalizeFilterText(label) === normalizeFilterText(labelFilter));
      const hasGaps = (record.gaps || []).length > 0;
      const hasInsights = (record.attentions || []).length > 0;
      const byAnalysis =
        effectiveAnalysisFilter === "all" ||
        (effectiveAnalysisFilter === "gaps_insights" && (hasGaps || hasInsights)) ||
        (effectiveAnalysisFilter === "critical" && record.severity === "critical") ||
        (effectiveAnalysisFilter === "high" && record.severity === "high") ||
        (effectiveAnalysisFilter === "medium" && record.severity === "medium") ||
        (effectiveAnalysisFilter === "low" && record.severity === "low") ||
        (effectiveAnalysisFilter === "info" && record.severity === "info");
      const phase = normalizeClientPhase(record.clientPhase);
      const byPhase = phaseFilter === "all" || phase === phaseFilter;
      const bucket = normalizeResponsibleBucket(record.responsibleBucket || record.responsibleLabel || "ia");
      const byResponsible = effectiveResponsibleFilter === "all" || bucket === effectiveResponsibleFilter;
      const byFavorite = !favoritesOnly || favoritePhones.includes(record.phonePk);
      const byPinned = !pinnedOnly || pinnedPhones.includes(record.phonePk);
      return byText && byStatus && byLabel && byAnalysis && byPhase && byResponsible && byFavorite && byPinned;
    });

    return list.sort((a, b) => {
      const pinDiff = Number(pinnedPhones.includes(b.phonePk)) - Number(pinnedPhones.includes(a.phonePk));
      if (pinDiff !== 0) return pinDiff;
      const favDiff = Number(favoritePhones.includes(b.phonePk)) - Number(favoritePhones.includes(a.phonePk));
      if (favDiff !== 0) return favDiff;
      return String(a.contactName || "").localeCompare(String(b.contactName || ""), "pt-BR");
    });
  }, [effectiveAnalysisFilter, effectiveResponsibleFilter, favoritePhones, favoritesOnly, labelFilter, phaseFilter, pinnedOnly, pinnedPhones, query, records, statusFilter]);

  const recordsByStatus = useMemo(() => {
    const grouped: Record<AccountStatus, ClientRecordItem[]> = {
      entrada: [],
      remarketing: [],
      atencao: [],
      resolvido: [],
    };

    for (const record of filteredRecords) {
      const status = mapStatus(record);
      grouped[status].push(record);
    }

    return grouped;
  }, [filteredRecords]);

  const hasActiveFilters = useMemo(
    () =>
      Boolean(query.trim()) ||
      statusFilter !== "all" ||
      labelFilter !== "all" ||
      effectiveAnalysisFilter !== "all" ||
      effectiveResponsibleFilter !== "all" ||
      phaseFilter !== "all" ||
      favoritesOnly ||
      pinnedOnly,
    [effectiveAnalysisFilter, effectiveResponsibleFilter, favoritesOnly, labelFilter, phaseFilter, pinnedOnly, query, statusFilter],
  );
  const shouldDimKanban = filteredRecords.length === 0;

  const visibleStatuses = useMemo(() => {
    if (!hasActiveFilters) return STATUS_ORDER;
    return STATUS_ORDER.filter((status) => recordsByStatus[status].length > 0);
  }, [hasActiveFilters, recordsByStatus]);
  const filteredColsClass = hasActiveFilters ? `cols-${Math.min(4, Math.max(1, visibleStatuses.length))}` : "";
  const statusSummary = useMemo(
    () => ({
      entrada: recordsByStatus.entrada.length,
      remarketing: recordsByStatus.remarketing.length,
      atencao: recordsByStatus.atencao.length,
      resolvido: recordsByStatus.resolvido.length,
    }),
    [recordsByStatus],
  );

  function toggleFavorite(phonePk: string) {
    setFavoritePhones((current) =>
      current.includes(phonePk) ? current.filter((item) => item !== phonePk) : [...current, phonePk],
    );
  }

  function togglePinned(phonePk: string) {
    setPinnedPhones((current) =>
      current.includes(phonePk) ? current.filter((item) => item !== phonePk) : [...current, phonePk],
    );
  }

  return (
    <section className="accounts-shell">
      <div className="section-inner">
        <HileSectionShell
          eyebrow="01"
          title="Clientes"
          description={
            scope === "day"
              ? `Registros salvos para ${selectedDate}${runId ? ` (execução ${runId})` : ""} com leitura de ${ownerLabel}.`
              : `Base geral consolidada a partir de client_states para ${ownerLabel}.`
          }
        >
          <div className="hile-section-stack">
            <HileSurfaceCard
              title="Escopo dos clientes"
              description="Alterne entre o dia selecionado e a base consolidada, mantendo o owner ativo."
              tone="accent"
            >
              <div className="btn-group">
                <button
                  type="button"
                  className={`gap-chip ${scope === "day" ? "active" : ""}`}
                  onClick={() => {
                    setScopeAnimationSeed((value) => value + 1);
                    setSelectedRecord(null);
                    setScope("day");
                  }}
                >
                  Clientes do dia
                </button>
                <button
                  type="button"
                  className={`gap-chip ${scope === "overall" ? "active" : ""}`}
                  onClick={() => {
                    setScopeAnimationSeed((value) => value + 1);
                    setSelectedRecord(null);
                    setScope("overall");
                  }}
                >
                  Base geral de clientes
                </button>
              </div>
              <div className="btn-group" style={{ marginTop: "10px" }}>
                <button type="button" className={`gap-chip ${ownerScope === "all" ? "active" : ""}`} onClick={() => onSetOwnerScope("all")}>
                  Todos
                </button>
                <button type="button" className={`gap-chip ${ownerScope === "ia" ? "active" : ""}`} onClick={() => onSetOwnerScope("ia")}>
                  IA
                </button>
                <button type="button" className={`gap-chip ${ownerScope === "suellen" ? "active" : ""}`} onClick={() => onSetOwnerScope("suellen")}>
                  Suellen
                </button>
                <button type="button" className={`gap-chip ${ownerScope === "samuel" ? "active" : ""}`} onClick={() => onSetOwnerScope("samuel")}>
                  Samuel
                </button>
              </div>
            </HileSurfaceCard>

            <HileSurfaceCard title="Leitura ativa" description="Contexto rapido do recorte aplicado no kanban." tone="soft">
              <HilePillRow>
                <HilePill active>{scope === "day" ? "Clientes do dia" : "Base geral"}</HilePill>
                <HilePill tone="ghost">Owner: {ownerLabel}</HilePill>
                <HilePill tone="ghost">{scope === "day" ? `Data: ${selectedDate}` : "Consolidado salvo"}</HilePill>
              </HilePillRow>
            </HileSurfaceCard>

            <HileCardGrid cols={4}>
              <HileKpiCard label="Clientes" value={filteredRecords.length} hint="Registros após filtros" tone={filteredRecords.length > 0 ? "accent" : "default"} accent="accent" />
              <HileKpiCard label="Entrada" value={statusSummary.entrada} hint="Fluxo normal da IA" />
              <HileKpiCard label="Remarketing" value={statusSummary.remarketing} hint="Aguardando retorno comercial" />
              <HileKpiCard label="Atenção" value={statusSummary.atencao} hint="Casos com sinal operacional" tone={statusSummary.atencao > 0 ? "critical" : "default"} accent={statusSummary.atencao > 0 ? "high" : "default"} />
            </HileCardGrid>

            <div className="scope-switch-animated" key={`clients-scope-${scope}-${scopeAnimationSeed}`}>
              <div className="hile-section-stack">
                <HileSurfaceCard
                  title="Como funciona a classificação"
                  description="Regras operacionais que organizam os cartões no funil de clientes."
                >
                  <p>
                    <strong>Entrada:</strong> conversa no fluxo normal da IA, sem necessidade de ação imediata.
                  </p>
                  <p>
                    <strong>Remarketing:</strong> lead com indício de consultor/reunião e entre 6h e 24h aguardando retorno da equipe.
                  </p>
                  <p>
                    <strong>Atenção:</strong> conversa ainda no fluxo da IA com sinais operacionais que merecem acompanhamento.
                  </p>
                  <p>
                    <strong>Fora da IA:</strong> conversa com etiqueta de saída do fluxo da IA, como <code>lead_agendado</code> ou <code>pausar_ia</code>.
                  </p>
                  <p>
                    <strong>Fase do cliente:</strong> inicial (ideia sem estrutura), intermediário (já tem CNPJ/presença de marca) e avançado (já opera marca e busca otimização de terceirização com a Hile).
                  </p>
                </HileSurfaceCard>

                <AccountsFiltersCard
                  query={query}
                  onQueryChange={setQuery}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  labelFilter={labelFilter}
                  onLabelFilterChange={setLabelFilter}
                  labelsAvailable={labelsAvailable}
                  effectiveAnalysisFilter={effectiveAnalysisFilter}
                  onAnalysisFilterChange={setAnalysisFilter}
                  analysisFilterOptions={analysisFilterOptions}
                  responsibleFilter={effectiveResponsibleFilter}
                  onResponsibleFilterChange={setResponsibleFilter}
                  responsibleFilterLocked={ownerScope !== "all"}
                  phaseFilter={phaseFilter}
                  onPhaseFilterChange={setPhaseFilter}
                  favoritesOnly={favoritesOnly}
                  onFavoritesOnlyChange={setFavoritesOnly}
                  pinnedOnly={pinnedOnly}
                  onPinnedOnlyChange={setPinnedOnly}
                />

                <AccountsKanbanCard
                  shouldDimKanban={shouldDimKanban}
                  loading={loading}
                  errorMessage={errorMessage}
                  filteredRecords={filteredRecords}
                  hasActiveFilters={hasActiveFilters}
                  filteredColsClass={filteredColsClass}
                  visibleStatuses={visibleStatuses}
                  recordsByStatus={recordsByStatus}
                  favoritePhones={favoritePhones}
                  pinnedPhones={pinnedPhones}
                  onToggleFavorite={toggleFavorite}
                  onTogglePinned={togglePinned}
                  onSelectRecord={setSelectedRecord}
                />
              </div>
            </div>
          </div>
        </HileSectionShell>
      </div>

      {selectedRecord ? <AccountDetailModal record={selectedRecord} onClose={() => setSelectedRecord(null)} /> : null}
    </section>
  );
}

