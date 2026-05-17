import { useEffect, useMemo, useRef, useState } from "react";
import { FiExternalLink, FiMapPin, FiSearch, FiStar } from "react-icons/fi";
import { apiGet } from "@/lib/api";
import type { ClientRecordItem, ClientsByDateResponse, Severity } from "../../../types";
import { labelClass } from "./report/utils";

type AccountStatus = "aberto" | "atencao" | "resolvido";

interface AccountsViewProps {
  selectedDate: string;
  knownRunId?: string | null;
  refreshHint?: string | null;
}

const STATUS_ORDER: AccountStatus[] = ["aberto", "atencao", "resolvido"];
const CLIENTS_REVALIDATE_MS = 5 * 60 * 1000;
const CLIENTS_REVALIDATE_TODAY_MS = 60 * 1000;
const CLIENTS_CACHE_VERSION = "v3";

function normalizeFilterText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toDateTimeBr(isoText: string | null): string {
  if (!isoText) return "-";
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
}

function normalizeNarrativeDateTokens(text: string): string {
  if (!text) return text;
  return text.replace(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\]/g, (_, isoText: string) => {
    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) return `[${isoText}]`;
    return `[${date.toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}]`;
  });
}

function statusLabel(status: AccountStatus): string {
  if (status === "resolvido") return "Fora da IA";
  if (status === "atencao") return "Atenção";
  return "Em acompanhamento";
}

function timelineEventLabel(eventType: string): string {
  if (eventType === "issue_opened") return "Problema aberto";
  if (eventType === "issue_updated") return "Problema atualizado";
  if (eventType === "issue_resolved") return "Problema resolvido";
  if (eventType === "moved_out_of_ai") return "Saiu do fluxo da IA";
  return eventType || "Evento operacional";
}

function severityLabel(severity: Severity): string {
  if (severity === "critical") return "Crítico";
  if (severity === "high") return "Alto";
  if (severity === "medium") return "Médio";
  if (severity === "low") return "Baixo";
  return "Informativo";
}

function severityClass(severity: Severity): string {
  if (severity === "critical") return "sev-critical";
  if (severity === "high") return "sev-high";
  if (severity === "medium") return "sev-medium";
  if (severity === "low") return "sev-low";
  return "sev-info";
}

function normalizeLabelKey(label: string): string {
  return String(label || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hasExitFromAiLabel(labels: string[]): boolean {
  const normalized = (labels || []).map(normalizeLabelKey);
  return normalized.includes("lead_agendado") || normalized.includes("pausar_ia");
}

function mapStatus(record: ClientRecordItem): AccountStatus {
  if (hasExitFromAiLabel(record.labels || [])) return "resolvido";
  if (record.status === "resolvido") return "resolvido";
  if (record.status === "atencao") return "atencao";
  return "aberto";
}

function dateKeyNowFortaleza(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date());
}

export function AccountsView({ selectedDate, knownRunId = null, refreshHint = null }: AccountsViewProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [favoritePhones, setFavoritePhones] = useState<string[]>([]);
  const [pinnedPhones, setPinnedPhones] = useState<string[]>([]);
  const [records, setRecords] = useState<ClientRecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<ClientRecordItem | null>(null);
  const handledRefreshHintRef = useRef<string | null>(null);
  const cacheKey = `hile_clients_cache_${CLIENTS_CACHE_VERSION}_${selectedDate}`;
  const fetchMetaKey = `hile_clients_fetch_meta_${CLIENTS_CACHE_VERSION}_${selectedDate}`;

  useEffect(() => {
    try {
      const savedFavorites = localStorage.getItem("hile_accounts_favorites");
      const savedPinned = localStorage.getItem("hile_accounts_pinned");
      setFavoritePhones(savedFavorites ? JSON.parse(savedFavorites) : []);
      setPinnedPhones(savedPinned ? JSON.parse(savedPinned) : []);
    } catch {
      setFavoritePhones([]);
      setPinnedPhones([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("hile_accounts_favorites", JSON.stringify(favoritePhones));
  }, [favoritePhones]);

  useEffect(() => {
    localStorage.setItem("hile_accounts_pinned", JSON.stringify(pinnedPhones));
  }, [pinnedPhones]);

  useEffect(() => {
    try {
      const cachedRaw = localStorage.getItem(cacheKey);
      if (!cachedRaw) return;
      const cached = JSON.parse(cachedRaw) as {
        runId: string | null;
        records: ClientRecordItem[];
      };
      if (Array.isArray(cached.records)) {
        setRecords(cached.records);
        setRunId(cached.runId || null);
      }
    } catch {
      // cache inválido
    }
  }, [cacheKey]);

  useEffect(() => {
    let cancelled = false;
    const hasNewRefreshHint = Boolean(refreshHint) && refreshHint !== handledRefreshHintRef.current;
    if (hasNewRefreshHint && refreshHint) {
      handledRefreshHintRef.current = refreshHint;
    }

    const now = Date.now();
    const isToday = selectedDate === dateKeyNowFortaleza();

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

    const runMismatch = Boolean(knownRunId) && knownRunId !== cachedRunId;
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

    apiGet<ClientsByDateResponse>(`/api/clients?date=${encodeURIComponent(selectedDate)}`)
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

        sessionStorage.setItem(fetchMetaKey, JSON.stringify({ fetchedAt: Date.now(), runId: incomingRunId }));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (records.length === 0) {
          setRecords([]);
          setRunId(null);
        }
        setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar clientes.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, fetchMetaKey, knownRunId, records.length, refreshHint, selectedDate]);

  const labelsAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const record of records) {
      for (const label of record.labels || []) {
        set.add(label);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [records]);

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
      const byFavorite = !favoritesOnly || favoritePhones.includes(record.phonePk);
      const byPinned = !pinnedOnly || pinnedPhones.includes(record.phonePk);
      return byText && byStatus && byLabel && byFavorite && byPinned;
    });

    return list.sort((a, b) => {
      const pinDiff = Number(pinnedPhones.includes(b.phonePk)) - Number(pinnedPhones.includes(a.phonePk));
      if (pinDiff !== 0) return pinDiff;
      const favDiff = Number(favoritePhones.includes(b.phonePk)) - Number(favoritePhones.includes(a.phonePk));
      if (favDiff !== 0) return favDiff;
      return String(a.contactName || "").localeCompare(String(b.contactName || ""), "pt-BR");
    });
  }, [favoritePhones, favoritesOnly, labelFilter, pinnedOnly, pinnedPhones, query, records, statusFilter]);

  const recordsByStatus = useMemo(() => {
    const grouped: Record<AccountStatus, ClientRecordItem[]> = {
      aberto: [],
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
    () => Boolean(query.trim()) || statusFilter !== "all" || labelFilter !== "all" || favoritesOnly || pinnedOnly,
    [favoritesOnly, labelFilter, pinnedOnly, query, statusFilter],
  );
  const shouldDimKanban = filteredRecords.length === 0;

  const visibleStatuses = useMemo(() => {
    if (!hasActiveFilters) return STATUS_ORDER;
    return STATUS_ORDER.filter((status) => recordsByStatus[status].length > 0);
  }, [hasActiveFilters, recordsByStatus]);

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
      <header className="accounts-header">
        <h1>Clientes</h1>
        <p>
          Chave primária operacional: <strong>telefone</strong>. Registros carregados do banco para{" "}
          <strong>{selectedDate}</strong>
          {runId ? <> (execução: <code>{runId}</code>)</> : null}.
        </p>
      </header>

      <article className="settings-card">
        <div className="settings-card-head">Como funciona a classificação</div>
        <div className="settings-card-body">
          <p>
            <strong>Em acompanhamento:</strong> conversa ainda dentro do fluxo da IA e sem etiqueta de saída.
          </p>
          <p>
            <strong>Atenção:</strong> conversa ainda no fluxo da IA com sinais operacionais que merecem acompanhamento.
          </p>
          <p>
            <strong>Fora da IA:</strong> conversa com etiqueta de saída do fluxo da IA, como{" "}
            <code>lead_agendado</code> ou <code>pausar_ia</code>.
          </p>
        </div>
      </article>

      <article className="settings-card" id="clients-filtros">
        <div className="settings-card-head">Filtros</div>
        <div className="settings-card-body accounts-filters">
          <div className="accounts-search">
            <FiSearch aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nome, telefone, CNPJ ou empresa"
            />
          </div>

          <div className="accounts-filter-row">
            <label>
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | AccountStatus)}>
                <option value="all">Todos</option>
                <option value="aberto">Em acompanhamento</option>
                <option value="atencao">Atenção</option>
                <option value="resolvido">Fora da IA</option>
              </select>
            </label>

            <label>
              Etiqueta
              <select value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)}>
                <option value="all">Todas</option>
                {labelsAvailable.map((label) => (
                  <option value={label} key={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="accounts-switch-row">
            <label className="accounts-switch">
              <input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />
              Apenas favoritos
            </label>

            <label className="accounts-switch">
              <input type="checkbox" checked={pinnedOnly} onChange={(event) => setPinnedOnly(event.target.checked)} />
              Apenas fixados
            </label>
          </div>
        </div>
      </article>

      <article className={`settings-card ${shouldDimKanban ? "data-dim" : ""}`} id="clients-kanban">
        <div className="settings-card-head">Kanban — {filteredRecords.length} cliente(s)</div>
        <div className="settings-card-body accounts-list-wrap">
          {loading ? <p className="empty-state">Carregando clientes do banco...</p> : null}
          {!loading && errorMessage ? <p className="empty-state">{errorMessage}</p> : null}
          {!loading && !errorMessage && filteredRecords.length === 0 ? (
            <p className="empty-state">Nenhum cliente encontrado com os filtros atuais.</p>
          ) : null}

          {!loading && !errorMessage && filteredRecords.length > 0 ? (
            <div className={`accounts-kanban ${hasActiveFilters ? "is-filtered" : ""}`}>
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
                                <span>{record.companyName || "Empresa não informada"}</span>
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
                                  onClick={() => toggleFavorite(record.phonePk)}
                                  title={isFavorite ? "Remover favorito" : "Favoritar"}
                                  aria-label={isFavorite ? "Remover favorito" : "Favoritar"}
                                >
                                  <FiStar />
                                </button>
                                <button
                                  type="button"
                                  className={`icon-toggle ${isPinned ? "on" : ""}`}
                                  onClick={() => togglePinned(record.phonePk)}
                                  title={isPinned ? "Desafixar" : "Fixar"}
                                  aria-label={isPinned ? "Desafixar" : "Fixar"}
                                >
                                  <FiMapPin />
                                </button>
                                <button className="btn btn-sm btn-primary" onClick={() => setSelectedRecord(record)}>
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

      {selectedRecord ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="clientDetailModalTitle">
          <div className="modal-card account-detail-modal">
            <div className="modal-header">
              <div>
                <h3 id="clientDetailModalTitle">{selectedRecord.contactName || "Contato sem nome"}</h3>
                <p>{selectedRecord.companyName || "Empresa não informada"}</p>
              </div>
              <button className="modal-close" aria-label="Fechar modal de detalhes" onClick={() => setSelectedRecord(null)}>
                ×
              </button>
            </div>

            <div className="modal-body">
              {(() => {
                const openedAt = selectedRecord.openedAt || null;
                const closedAt = selectedRecord.closedAt || null;

                return (
                  <>
              <div className="modal-row">
                <strong>Telefone</strong>
                <span>{selectedRecord.phonePk || "não informado"}</span>
              </div>
              <div className="modal-row">
                <strong>CNPJ</strong>
                <span>{selectedRecord.cnpj || "Não informado"}</span>
              </div>
              <div className="modal-row">
                <strong>Severidade</strong>
                <span>{severityLabel(selectedRecord.severity)}</span>
              </div>
              <div className="modal-row">
                <strong>Abertura</strong>
                <span>{toDateTimeBr(openedAt)}</span>
              </div>
              <div className="modal-row">
                <strong>Fechamento</strong>
                <span>{closedAt ? toDateTimeBr(closedAt) : "-"}</span>
              </div>
                  </>
                );
              })()}

              <div className="modal-section">
                <h4>Linha do tempo operacional</h4>
                {Array.isArray(selectedRecord.timeline) && selectedRecord.timeline.length > 0 ? (
                  <ul className="orq-timeline">
                    {selectedRecord.timeline.map((event, idx) => (
                      <li key={`${selectedRecord.phonePk}-timeline-${idx}`}>
                        <strong>{timelineEventLabel(event.eventType)}</strong>{" "}
                        em {toDateTimeBr(event.createdAt)}{" "}
                        {event.reason ? <>- {normalizeNarrativeDateTokens(event.reason)}</> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Sem eventos de timeline ainda.</p>
                )}
              </div>

              <div className="modal-section">
                <h4>Etiquetas</h4>
                <div className="account-tags">
                  {(selectedRecord.labels || []).length > 0 ? (
                    selectedRecord.labels.map((label) => (
                      <span className={labelClass(label)} key={`modal-${selectedRecord.phonePk}-${label}`}>
                        {label}
                      </span>
                    ))
                  ) : (
                    <span className="tag">sem etiqueta</span>
                  )}
                </div>
              </div>

              <div className="modal-section">
                <h4>Problemas e Atenções</h4>
                <div className="account-points-grid">
                  <section className="points-column">
                    <h4>Problemas (Gaps)</h4>
                    {selectedRecord.gaps.length > 0 ? (
                      <ul>
                        {selectedRecord.gaps.map((gap, index) => (
                          <li key={`${selectedRecord.phonePk}-gap-${index}`}>{normalizeNarrativeDateTokens(gap)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>Sem gaps registrados.</p>
                    )}
                  </section>

                  <section className="points-column">
                    <h4>Atenções</h4>
                    {selectedRecord.attentions.length > 0 ? (
                      <ul>
                        {selectedRecord.attentions.map((item, index) => (
                          <li key={`${selectedRecord.phonePk}-attention-${index}`}>{normalizeNarrativeDateTokens(item)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>Sem pontos de atenção registrados.</p>
                    )}
                  </section>
                </div>
              </div>

              <div className="modal-section">
                <h4>Conversas no Chatwoot</h4>
                <div className="account-links modal-chats">
                  {selectedRecord.chatLinks.length > 0 ? (
                    <div className="account-link-list">
                      {selectedRecord.chatLinks.map((link) => (
                        <a href={link} target="_blank" rel="noreferrer" key={link}>
                          <FiExternalLink aria-hidden="true" />
                          {link}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <span>Sem link disponível.</span>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary btn-sm" onClick={() => setSelectedRecord(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
