import type { ApiConfigPayload } from "../shared/types";

export function HeroSection({ apiConfig }: { apiConfig: ApiConfigPayload | null }) {
  return (
    <section className="hero reveal" id="inicio">
      <div className="hero-inner">
        <span className="hero-label"><span className="hero-label-dot" /> Indústria Hilê - Auditoria Inteligente</span>
        <h1>IA para transformar<br />conversa em <em>decisão operacional</em></h1>
        <p>
          Tela única de monitoramento para fluxo diário: extração no Chatwoot,
          leitura com IA no Dify, classificação de risco e relatório TXT com
          rastreabilidade de conversa.
        </p>
        <div className="hero-meta">
          <span className="hero-chip">Grupo: {apiConfig?.chatwoot_group_name || "Grupo Botta"}</span>
          <span className="hero-chip">Canal: {apiConfig?.chatwoot_inbox_name || "Atendimento"}</span>
          <span className="hero-chip">Timezone: {apiConfig?.timezone || "America/Fortaleza"}</span>
        </div>
      </div>
    </section>
  );
}
