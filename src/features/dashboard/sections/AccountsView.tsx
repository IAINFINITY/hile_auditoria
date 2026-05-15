import { useEffect, useMemo, useState } from "react";
import { FiMapPin, FiSearch, FiStar } from "react-icons/fi";
import type { ReportPayload, Severity } from "../../../types";
import { buildConversationLink, toChatwootAppBase } from "../hooks/controller/common";
import { PaginationControls } from "./report/PaginationControls";
import { labelClass, parseLabelsFromLogText, parsePossibleJsonObject } from "./report/utils";

type AccountStatus = "aberto" | "atencao" | "resolvido";

interface AccountRecord {
  phonePk: string;
  contactName: string;
  companyName: string;
  cnpj: string;
  gaps: string[];
  attentions: string[];
  labels: string[];
  conversationIds: number[];
  chatLinks: string[];
  openedAt: string;
  closedAt: string;
  status: AccountStatus;
  severity: Severity;
}

interface AccountsViewProps {
  report: ReportPayload | null;
  chatwootBaseUrl: string;
}

function normalizeDigits(value: unknown): string {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeFilterText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractPhoneFromText(text: string): string {
  const matches = text.match(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}-?\d{4}/g);
  if (!matches?.length) return "";
  const best = matches
    .map((item) => normalizeDigits(item))
    .filter((item) => item.length >= 10)
    .sort((a, b) => b.length - a.length)[0];
  return best || "";
}

function extractCnpj(text: string): string {
  const match = text.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
  return match?.[0] || "";
}

function extractCompanyName(text: string): string {
  const patterns = [
    /"empresa"\s*:\s*"([^"\n\r]+)"/i,
    /"nome_empresa"\s*:\s*"([^"\n\r]+)"/i,
    /"razao_social"\s*:\s*"([^"\n\r]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = String(match?.[1] || "").trim();
    if (value) return value;
  }

  return "";
}

function extractLogTimestamps(logText: string): string[] {
  const found = [...String(logText || "").matchAll(/\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/g)]
    .map((match) => String(match[1] || "").trim())
    .filter(Boolean);
  return found;
}

function toDateTimeBr(isoText: string): string {
  if (!isoText) return "-";
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function normalizeSeverity(value: unknown): Severity {
  const text = normalizeFilterText(value);
  if (text.includes("crit")) return "critical";
  if (text.includes("alt")) return "high";
  if (text.includes("med")) return "medium";
  if (text.includes("baix")) return "low";
  return "info";
}

function statusLabel(status: AccountStatus): string {
  if (status === "resolvido") return "Resolvido";
  if (status === "atencao") return "Atenção";
  return "Aberto";
}

function severityLabel(severity: Severity): string {
  if (severity === "critical") return "Crítico";
  if (severity === "high") return "Alto";
  if (severity === "medium") return "Médio";
  if (severity === "low") return "Baixo";
  return "Informativo";
}

function statusClass(status: AccountStatus): string {
  if (status === "resolvido") return "account-status ok";
  if (status === "atencao") return "account-status warn";
  return "account-status";
}

function createEmptyRecord(phonePk: string, contactName: string): AccountRecord {
  return {
    phonePk,
    contactName,
    companyName: "",
    cnpj: "",
    gaps: [],
    attentions: [],
    labels: [],
    conversationIds: [],
    chatLinks: [],
    openedAt: "",
    closedAt: "",
    status: "aberto",
    severity: "info",
  };
}

export function AccountsView({ report, chatwootBaseUrl }: AccountsViewProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [favoritePhones, setFavoritePhones] = useState<string[]>([]);
  const [pinnedPhones, setPinnedPhones] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 5;

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

  const accountRecords = useMemo<AccountRecord[]>(() => {
    const analyses = report?.raw_analysis?.analyses || [];
    if (analyses.length === 0) return [];

    const baseUrl = toChatwootAppBase(chatwootBaseUrl);
    const accountId = Number(report?.account?.id || 0);
    const inboxId = Number(report?.inbox?.id || 0);
    const map = new Map<string, AccountRecord>();

    for (const analysis of analyses) {
      const logText = String(analysis.log_text || "");
      const parsed = parsePossibleJsonObject(String(analysis.analysis?.answer || ""));
      const gapsRaw = Array.isArray(parsed.gaps_operacionais) ? parsed.gaps_operacionais : [];
      const improvementsRaw = Array.isArray(parsed.pontos_melhoria) ? parsed.pontos_melhoria : [];
      const severity = normalizeSeverity(parsed.severidade || parsed.severity || parsed.nivel_risco || parsed.risco);

      const fallbackPhone = normalizeDigits(analysis.contact?.identifier);
      const phonePk = fallbackPhone || extractPhoneFromText(logText) || `sem-telefone-${analysis.contact_key}`;
      const contactName =
        String(analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key || "Contato sem nome").trim();

      if (!map.has(phonePk)) {
        map.set(phonePk, createEmptyRecord(phonePk, contactName));
      }

      const record = map.get(phonePk)!;
      const nextContactName = String(analysis.contact?.name || "").trim();
      if (nextContactName && !record.contactName.includes(nextContactName)) {
        record.contactName = nextContactName;
      }

      const companyName = extractCompanyName(logText);
      if (companyName && !record.companyName) record.companyName = companyName;

      const cnpj = extractCnpj(logText);
      if (cnpj && !record.cnpj) record.cnpj = cnpj;

      const labels = (analysis.conversation_operational?.[0]?.state?.labels || []) as string[];
      const fallbackLabels = parseLabelsFromLogText(logText);
      for (const label of [...labels, ...fallbackLabels]) {
        const normalizedLabel = String(label || "").trim();
        if (normalizedLabel && !record.labels.includes(normalizedLabel)) {
          record.labels.push(normalizedLabel);
        }
      }

      const timestamps = extractLogTimestamps(logText);
      if (timestamps.length > 0) {
        const minTs = timestamps.slice().sort()[0];
        const maxTs = timestamps.slice().sort()[timestamps.length - 1];
        if (!record.openedAt || minTs < record.openedAt) record.openedAt = minTs;
        if (!record.closedAt || maxTs > record.closedAt) record.closedAt = maxTs;
      }

      for (const gapItem of gapsRaw) {
        if (typeof gapItem === "string") {
          const text = gapItem.trim();
          if (text && !record.gaps.includes(text)) record.gaps.push(text);
          continue;
        }
        const gapObj = gapItem && typeof gapItem === "object" ? (gapItem as Record<string, unknown>) : {};
        const text = String(gapObj.descricao || gapObj.description || gapObj.nome_gap || gapObj.gap || "").trim();
        if (text && !record.gaps.includes(text)) record.gaps.push(text);
      }

      for (const item of improvementsRaw) {
        const text = String(item || "").trim();
        if (text && !record.attentions.includes(text)) record.attentions.push(text);
      }

      for (const conversationId of analysis.conversation_ids || []) {
        const id = Number(conversationId || 0);
        if (!id) continue;
        if (!record.conversationIds.includes(id)) record.conversationIds.push(id);
        const url = buildConversationLink(baseUrl, accountId, inboxId, id);
        if (url && !record.chatLinks.includes(url)) record.chatLinks.push(url);
      }

      const state = analysis.conversation_operational?.[0]?.state;
      const isResolved = state?.finalization_status === "finalizada";
      if (isResolved) {
        record.status = "resolvido";
      } else if (record.gaps.length > 0 || severity === "critical" || severity === "high") {
        record.status = "atencao";
      } else {
        record.status = "aberto";
      }

      if (["critical", "high", "medium", "low"].indexOf(severity) >= 0) {
        const order: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
        if (order[severity] > order[record.severity]) {
          record.severity = severity;
        }
      }
    }

    return Array.from(map.values());
  }, [chatwootBaseUrl, report]);

  const labelsAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const record of accountRecords) {
      for (const label of record.labels) {
        set.add(label);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [accountRecords]);

  const filteredRecords = useMemo(() => {
    const q = normalizeFilterText(query);
    const list = accountRecords.filter((record) => {
      const byText =
        !q ||
        normalizeFilterText(record.contactName).includes(q) ||
        normalizeFilterText(record.phonePk).includes(q) ||
        normalizeFilterText(record.companyName).includes(q) ||
        normalizeFilterText(record.cnpj).includes(q);
      const byStatus = statusFilter === "all" || record.status === statusFilter;
      const byLabel = labelFilter === "all" || record.labels.some((label) => normalizeFilterText(label) === normalizeFilterText(labelFilter));
      const byFavorite = !favoritesOnly || favoritePhones.includes(record.phonePk);
      const byPinned = !pinnedOnly || pinnedPhones.includes(record.phonePk);
      return byText && byStatus && byLabel && byFavorite && byPinned;
    });

    return list.sort((a, b) => {
      const pinDiff = Number(pinnedPhones.includes(b.phonePk)) - Number(pinnedPhones.includes(a.phonePk));
      if (pinDiff !== 0) return pinDiff;
      const favDiff = Number(favoritePhones.includes(b.phonePk)) - Number(favoritePhones.includes(a.phonePk));
      if (favDiff !== 0) return favDiff;
      return a.contactName.localeCompare(b.contactName, "pt-BR");
    });
  }, [accountRecords, favoritePhones, favoritesOnly, labelFilter, pinnedOnly, pinnedPhones, query, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, labelFilter, favoritesOnly, pinnedOnly]);

  const pages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const visible = filteredRecords.slice((safePage - 1) * pageSize, safePage * pageSize);

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
          Chave primária operacional: <strong>telefone</strong>. Todos os clientes são agrupados e rastreados por esse dado.
        </p>
      </header>

      <article className="settings-card">
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
                <option value="aberto">Aberto</option>
                <option value="atencao">Atenção</option>
                <option value="resolvido">Resolvido</option>
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

      <article className="settings-card">
        <div className="settings-card-head">Registros ({filteredRecords.length})</div>
        <div className="settings-card-body accounts-list-wrap">
          {visible.length === 0 ? (
            <p className="empty-state">Nenhuma conta encontrada com os filtros atuais.</p>
          ) : (
            <div className="accounts-list">
              {visible.map((record) => {
                const isFavorite = favoritePhones.includes(record.phonePk);
                const isPinned = pinnedPhones.includes(record.phonePk);
                return (
                  <article className="account-card" key={record.phonePk}>
                    <div className="account-card-head">
                      <div>
                        <h3>{record.contactName}</h3>
                        <p>Telefone (PK): {record.phonePk || "não informado"}</p>
                      </div>
                      <div className="account-actions">
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
                      </div>
                    </div>

                    <div className="account-grid">
                      <p><strong>Empresa:</strong> {record.companyName || "Não informado"}</p>
                      <p><strong>CNPJ:</strong> {record.cnpj || "Não informado"}</p>
                      <p><strong>Abertura:</strong> {toDateTimeBr(record.openedAt)}</p>
                      <p><strong>Fechamento:</strong> {record.status === "resolvido" ? toDateTimeBr(record.closedAt) : "Ainda em andamento"}</p>
                      <p><strong>Status:</strong> <span className={statusClass(record.status)}>{statusLabel(record.status)}</span></p>
                      <p><strong>Severidade:</strong> {severityLabel(record.severity)}</p>
                    </div>

                    <div className="account-tags">
                      {record.labels.length > 0 ? (
                        record.labels.map((label) => (
                          <span className={labelClass(label)} key={`${record.phonePk}-${label}`}>
                            {label}
                          </span>
                        ))
                      ) : (
                        <span className="tag">sem etiqueta</span>
                      )}
                    </div>

                    <div className="account-points-grid">
                      <div>
                        <h4>Problemas (Gaps)</h4>
                        {record.gaps.length > 0 ? (
                          <ul>
                            {record.gaps.slice(0, 3).map((gap) => (
                              <li key={gap}>{gap}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>Sem gaps registrados.</p>
                        )}
                      </div>

                      <div>
                        <h4>Atenções</h4>
                        {record.attentions.length > 0 ? (
                          <ul>
                            {record.attentions.slice(0, 3).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>Sem pontos de atenção registrados.</p>
                        )}
                      </div>
                    </div>

                    <div className="account-links">
                      <strong>Chats relacionados:</strong>
                      {record.chatLinks.length > 0 ? (
                        <div className="account-link-list">
                          {record.chatLinks.map((link) => (
                            <a href={link} target="_blank" rel="noreferrer" key={link}>
                              {link}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span>Sem link disponível.</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {filteredRecords.length > pageSize ? (
            <PaginationControls
              total={filteredRecords.length}
              safePage={safePage}
              pages={pages}
              onPrev={() => setPage(Math.max(1, safePage - 1))}
              onNext={() => setPage(Math.min(pages, safePage + 1))}
            />
          ) : null}
        </div>
      </article>
    </section>
  );
}
