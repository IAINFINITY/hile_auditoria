import { FiExternalLink } from "react-icons/fi";
import type { ClientRecordItem } from "../../../../../types";
import { labelClass } from "../../report/utils";
import {
  clientPhaseClass,
  clientPhaseLabel,
  formatProductDisplayName,
  normalizeNarrativeDateTokens,
  responsibleLabel,
  severityLabel,
  timelineEventLabel,
  toDateTimeBr,
} from "./helpers";

interface AccountDetailModalProps {
  record: ClientRecordItem;
  onClose: () => void;
}

export function AccountDetailModal({ record, onClose }: AccountDetailModalProps) {
  const openedAt = record.openedAt || null;
  const closedAt = record.closedAt || null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="clientDetailModalTitle">
      <div className="modal-card account-detail-modal">
        <div className="modal-header">
          <div>
            <h3 id="clientDetailModalTitle">{record.contactName || "Contato sem nome"}</h3>
            <p>{record.companyName || "Empresa não informada"}</p>
          </div>
          <button className="modal-close" aria-label="Fechar modal de detalhes" onClick={onClose}>
            ?
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-row">
            <strong>Telefone</strong>
            <span>{record.phonePk || "não informado"}</span>
          </div>
          <div className="modal-row">
            <strong>CNPJ</strong>
            <span>{record.cnpj || "Não informado"}</span>
          </div>
          <div className="modal-row">
            <strong>Severidade</strong>
            <span>{severityLabel(record.severity)}</span>
          </div>
          <div className="modal-row">
            <strong>Responsável rastreado</strong>
            <span>
              {responsibleLabel(record.responsibleBucket || record.responsibleLabel || "ia")}
              {typeof record.responsibleMessageCount === "number" ? ` (${record.responsibleMessageCount} msg)` : ""}
            </span>
          </div>
          <div className="modal-row">
            <strong>Fase do cliente</strong>
            <span className={`client-phase-badge ${clientPhaseClass(record.clientPhase)}`}>{clientPhaseLabel(record.clientPhase)}</span>
          </div>
          <div className="modal-row">
            <strong>Abertura</strong>
            <span>{toDateTimeBr(openedAt)}</span>
          </div>
          <div className="modal-row">
            <strong>Fechamento</strong>
            <span>{closedAt ? toDateTimeBr(closedAt) : "-"}</span>
          </div>
          <div className="modal-row">
            <strong>Finalizada por</strong>
            <span>{record.finalizationActor || "-"}</span>
          </div>

          <div className="modal-section">
            <h4>Linha do tempo operacional</h4>
            {Array.isArray(record.timeline) && record.timeline.length > 0 ? (
              <ul className="orq-timeline">
                {record.timeline.map((event, idx) => (
                  <li key={`${record.phonePk}-timeline-${idx}`}>
                    <strong>{timelineEventLabel(event.eventType)}</strong> em {toDateTimeBr(event.createdAt)}{" "}
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
              {(record.labels || []).length > 0 ? (
                record.labels.map((label) => (
                  <span className={labelClass(label)} key={`modal-${record.phonePk}-${label}`}>
                    {label}
                  </span>
                ))
              ) : (
                <span className="tag">sem etiqueta</span>
              )}
            </div>
          </div>

          <div className="modal-section">
            <h4>Produtos citados</h4>
            <div className="account-tags account-product-tags">
              {(record.products || []).length > 0 ? (
                record.products.map((product) => (
                  <span className="tag account-product-tag" key={`modal-${record.phonePk}-product-${product}`}>
                    {formatProductDisplayName(product)}
                  </span>
                ))
              ) : (
                <span className="tag account-product-tag account-product-tag-empty">sem produtos mapeados</span>
              )}
            </div>
          </div>

          <div className="modal-section">
            <h4>Classificação de fase</h4>
            <p>{record.clientPhaseReason || "Classificação baseada em sinais operacionais da conversa."}</p>
          </div>

          <div className="modal-section">
            <h4>Problemas e Atenções</h4>
            <div className="account-points-grid">
              <section className="points-column">
                <h4>Problemas (Gaps)</h4>
                {record.gaps.length > 0 ? (
                  <ul>
                    {record.gaps.map((gap, index) => (
                      <li key={`${record.phonePk}-gap-${index}`}>{normalizeNarrativeDateTokens(gap)}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Sem gaps registrados.</p>
                )}
              </section>

              <section className="points-column">
                <h4>Atenções</h4>
                {record.attentions.length > 0 ? (
                  <ul>
                    {record.attentions.map((item, index) => (
                      <li key={`${record.phonePk}-attention-${index}`}>{normalizeNarrativeDateTokens(item)}</li>
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
              {record.chatLinks.length > 0 ? (
                <div className="account-link-list">
                  {record.chatLinks.map((link) => (
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
          <button className="btn btn-primary btn-sm" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

