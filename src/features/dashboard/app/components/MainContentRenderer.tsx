import { AccountsView } from "@/features/dashboard/sections/clients/AccountsView";
import { AnalysisOverallView } from "@/features/dashboard/sections/analysis/AnalysisOverallView";
import { AttendantsView } from "@/features/dashboard/sections/attendants/AttendantsView";
import { DissatisfactionOverallView } from "@/features/dashboard/sections/dissatisfaction/DissatisfactionOverallView";
import { DissatisfactionView } from "@/features/dashboard/sections/dissatisfaction/DissatisfactionView";
import { GapsSection } from "@/features/dashboard/sections/dashboard/GapsSection";
import { InsightsSection } from "@/features/dashboard/sections/dashboard/InsightsSection";
import { LogsView } from "@/features/dashboard/sections/logs/LogsView";
import { MetricsSection } from "@/features/dashboard/sections/dashboard/MetricsSection";
import { MovementSection } from "@/features/dashboard/sections/dashboard/MovementSection";
import { ProductsDualView } from "@/features/dashboard/sections/products/ProductsDualView";
import { ProductsView } from "@/features/dashboard/sections/products/ProductsView";
import { SettingsView } from "@/features/dashboard/sections/settings/SettingsView";
import { SuperadminAccountsView } from "@/features/dashboard/sections/superadmin/SuperadminAccountsView";
import {
  HileCardGrid,
  HileEmptyPanel,
  HileKpiCard,
  HilePill,
  HilePillRow,
  HileSectionShell,
  HileSurfaceCard,
} from "@/features/dashboard/shared/ui/HilePrimitives";
import type { DashboardController } from "../dashboardTypes";
import type { AppView } from "../types";
import type { OwnerScope } from "@/features/dashboard/shared/types";

interface MainContentRendererProps {
  activeView: AppView;
  analysisScope: "day" | "overall";
  dissatisfactionScope: "day" | "overall";
  controller: DashboardController;
  clientsSnapshotDate: string;
  selectedDateKnownRunId: string | null;
  currentUser: { name: string; email: string; role: string } | null;
  onUpdateProfile: (updates: { name?: string; role?: string }) => void;
  onRequestOverview: () => void;
  onOpenLogs: () => void;
  onOpenReportByContact: (contactName: string) => void;
  onSetAnalysisScope: (scope: "day" | "overall") => void;
  onSetDissatisfactionScope: (scope: "day" | "overall") => void;
  ownerScope: OwnerScope;
  onSetOwnerScope: (scope: OwnerScope) => void;
}

function ownerScopeLabel(scope: OwnerScope): string {
  if (scope === "ia") return "IA";
  if (scope === "suellen") return "Comercial Suellen";
  if (scope === "samuel") return "Comercial Samuel";
  return "Todos";
}

export function MainContentRenderer({
  activeView,
  analysisScope,
  dissatisfactionScope,
  controller,
  clientsSnapshotDate,
  selectedDateKnownRunId,
  currentUser,
  onRequestOverview,
  onOpenLogs,
  onOpenReportByContact,
  onSetAnalysisScope,
  onSetDissatisfactionScope,
  ownerScope,
  onSetOwnerScope,
  onUpdateProfile,
}: MainContentRendererProps) {
  const analysisOverallRefreshHint = `overview-runs:${controller.overviewRunCount}`;
  const dayOverview = controller.overview?.overview;
  const dayConversations = Number(dayOverview?.conversations_total_analyzed_day || 0);
  const dayMessages = Number(dayOverview?.total_messages_day || 0);
  const dayCritical = Number(dayOverview?.critical_insights_count || 0);
  const dayNonCritical = Number(dayOverview?.non_critical_insights_count || 0);
  const dayTotalInsights = dayCritical + dayNonCritical;
  const dayFinalized = Number(dayOverview?.finalized_count || 0);
  const dayContinued = Number(dayOverview?.continued_count || 0);
  const dayHasFinalizationBase = dayFinalized + dayContinued > 0;
  const dayCriticalRate = dayTotalInsights > 0 ? dayCritical / dayTotalInsights : 0;
  const dayAvgMessagesPerConversation = dayConversations > 0 ? dayMessages / dayConversations : 0;
  const dayFinalizedRate = dayHasFinalizationBase ? dayFinalized / (dayFinalized + dayContinued) : 0;
  const dayHasScopedData =
    dayConversations > 0 ||
    dayMessages > 0 ||
    dayTotalInsights > 0 ||
    dayFinalized > 0 ||
    dayContinued > 0;

  if (activeView === "dashboard") {
    return (
      <div className="dashboard-animated" key="dashboard-view">
        <MetricsSection
          date={controller.date}
          setDate={controller.setDate}
          minDate={controller.minDate}
          maxDate={controller.maxDate}
          periodPreset={controller.periodPreset}
          applyPeriodPreset={controller.applyPeriodPreset}
          isBusy={controller.isBusy}
          isRunningOverview={controller.isRunningOverview}
          onRequestOverview={onRequestOverview}
          onOpenLogs={onOpenLogs}
          overview={controller.overview}
          severitySnapshot={controller.severitySnapshot}
          runProgress={controller.runProgress}
          runCurrentContact={controller.runCurrentContact}
          runTimeline={controller.runTimeline}
          selectedDateInfo={controller.selectedDateInfo}
          selectedDateHasSavedReport={controller.selectedDateHasSavedReport}
          clientAvgResponseMinutes={controller.clientAvgResponseMinutes}
          clientPeakHourLabel={controller.clientPeakHourLabel}
          currentStatus={controller.status}
        />

        <GapsSection
          insightsReady={controller.insightsReady}
          criticalGapInsights={controller.criticalGapInsights}
          overview={controller.overview}
          chatwootBaseUrl={controller.apiConfig?.chatwoot_base_url || ""}
          onOpenReportByContact={controller.focusReportByContact}
          operationalAlerts={controller.operationalAlerts}
        />

        <InsightsSection
          insightsReady={controller.insightsReady}
          gaugeData={controller.gaugeData}
          overviewRunCount={controller.overviewRunCount}
          riskRows={controller.riskRows}
          insightFilter={controller.insightFilter}
          setInsightFilter={controller.setInsightFilter}
          filteredInsights={controller.filteredInsights}
          visibleInsights={controller.visibleInsights}
          insightsPage={controller.insightsPage}
          totalInsightPages={controller.totalInsightPages}
          setInsightsPage={controller.setInsightsPage}
          onOpenReportByContact={controller.focusReportByContact}
        />
      </div>
    );
  }

  if (activeView === "clients") {
    return (
      <div className="settings-animated" key="clients-view">
        <AccountsView
          selectedDate={clientsSnapshotDate}
          knownRunId={selectedDateKnownRunId}
          refreshHint={controller.lastRunAt}
          ownerScope={ownerScope}
          onSetOwnerScope={onSetOwnerScope}
        />
      </div>
    );
  }

  if (activeView === "logs") {
    return (
      <div className="settings-animated" key="logs-view">
        <LogsView
          systemCheck={controller.systemCheck}
          reportHistory={controller.reportHistory}
          currentStatus={controller.status}
          isRunningOverview={controller.isRunningOverview}
          currentRunId={controller.currentRunId}
          runProgress={controller.runProgress}
          runCurrentContact={controller.runCurrentContact}
          runTimeline={controller.runTimeline}
        />
      </div>
    );
  }

  if (activeView === "analysis") {
    return (
      <div className="settings-animated analysis-animated" key="analysis-view">
        <div className="section reveal">
          <div className="section-inner">
            <HileSectionShell
              eyebrow="01"
              title="Análise"
              description={
                analysisScope === "day"
                  ? `Visão do dia selecionado (${controller.date}).`
                  : "Visão geral consolidada de todas as execuções salvas."
              }
            >
              <div className="hile-section-stack">
                <HileSurfaceCard
                  title="Escopo da análise"
                  description="Defina se a leitura será diária ou consolidada e ajuste o responsável exibido no painel."
                  tone="accent"
                >
                  <div className="btn-group">
                    <button type="button" className={`gap-chip ${analysisScope === "day" ? "active" : ""}`} onClick={() => onSetAnalysisScope("day")}>
                      Análise do dia
                    </button>
                    <button
                      type="button"
                      className={`gap-chip ${analysisScope === "overall" ? "active" : ""}`}
                      onClick={() => onSetAnalysisScope("overall")}
                    >
                      Análise total
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

                <HileSurfaceCard
                  title="Como interpretar esta análise"
                  description="Leitura orientada para o escopo ativo, sem misturar o dia com o consolidado."
                  tone="soft"
                >
                  {analysisScope === "day" ? (
                    <div className="hile-section-stack">
                      <HilePillRow>
                        <HilePill active>Análise do Dia</HilePill>
                        <HilePill tone="ghost">Data: {controller.date}</HilePill>
                        <HilePill tone="ghost">Owner: {ownerScopeLabel(ownerScope)}</HilePill>
                      </HilePillRow>
                      <p>
                        <strong>Análise do Dia:</strong> sempre considera somente os dados da data selecionada no período.
                      </p>
                      <p>
                        <strong>Movimentação:</strong> mostra volume horário e distribuição de severidade para o mesmo dia.
                      </p>
                      <p>
                        <strong>Produtos e Contexto:</strong> lista produtos detectados e insights informativos desse dia, sem misturar com outras datas.
                      </p>
                    </div>
                  ) : (
                    <div className="hile-section-stack">
                      <HilePillRow>
                        <HilePill active>Análise Total</HilePill>
                        <HilePill tone="ghost">Consolidado salvo</HilePill>
                        <HilePill tone="ghost">Owner: {ownerScopeLabel(ownerScope)}</HilePill>
                      </HilePillRow>
                      <p>
                        <strong>Análise Total:</strong> consolida os dados de todas as execuções salvas no período exibido.
                      </p>
                      <p>
                        <strong>Movimentação:</strong> mostra volume horário e distribuição de severidade no consolidado geral.
                      </p>
                      <p>
                        <strong>Produtos e Contexto:</strong> reúne produtos detectados e insights informativos de múltiplas datas, sem limitar a um único dia.
                      </p>
                    </div>
                  )}
                </HileSurfaceCard>
              </div>
            </HileSectionShell>
          </div>
        </div>

        {analysisScope === "overall" ? (
          <AnalysisOverallView
            key={`analysis-overall-${ownerScope}`}
            refreshHint={analysisOverallRefreshHint}
            sectionStart={2}
            ownerScope={ownerScope}
          />
        ) : (
          <>
            <div className="section reveal" id="analysis-overview">
              <div className="section-inner">
                <HileSectionShell
                  eyebrow="02"
                  title="Análise Geral do Dia"
                  description={`Esta leitura considera somente os dados de ${controller.date} para ${ownerScopeLabel(ownerScope)}.`}
                  muted={!dayHasScopedData}
                >
                  <div className="hile-section-stack">
                    <HileCardGrid cols={4}>
                      <HileKpiCard
                        label="Relatórios"
                        value={controller.selectedDateHasSavedReport ? 1 : 0}
                        hint={`Data selecionada: ${controller.date}`}
                        tone={controller.selectedDateHasSavedReport ? "accent" : "default"}
                        accent="accent"
                      />
                      <HileKpiCard
                        label="Conversas"
                        value={dayConversations}
                        hint="Total consolidado no período"
                        tone={dayConversations > 0 ? "accent" : "default"}
                        accent="accent"
                      />
                      <HileKpiCard
                        label="Mensagens"
                        value={dayMessages}
                        hint="IA + usuário no consolidado"
                        accent="accent"
                      />
                      <HileKpiCard
                        label="Críticos"
                        value={dayCritical}
                        hint={`${dayTotalInsights} insights • taxa crítica ${(dayCriticalRate * 100).toFixed(1)}%`}
                        tone={dayCritical > 0 ? "critical" : "default"}
                        accent={dayCritical > 0 ? "critical" : "default"}
                      />
                    </HileCardGrid>

                    <HileSurfaceCard title="Indicadores complementares" description="Resumo operacional do dia no escopo selecionado." tone="soft">
                      <HileCardGrid cols={4}>
                        <HileKpiCard label="Média msg/conversa" value={dayAvgMessagesPerConversation.toFixed(1)} hint="Volume médio por atendimento" />
                        <HileKpiCard label="Finalizadas" value={dayFinalized} hint="Conversas encerradas no dia" accent="success" />
                        <HileKpiCard label="Continuadas" value={dayContinued} hint="Conversas que seguiram abertas" />
                        <HileKpiCard
                          label="Taxa de finalização"
                          value={dayHasFinalizationBase ? `${(dayFinalizedRate * 100).toFixed(1)}%` : "-"}
                          hint="Finalizadas / (finalizadas + continuadas)"
                          tone={dayHasFinalizationBase ? "success" : "default"}
                          accent={dayHasFinalizationBase ? "success" : "default"}
                        />
                      </HileCardGrid>
                    </HileSurfaceCard>

                    {!dayHasScopedData ? (
                      <HileEmptyPanel
                        title="Sem dados no escopo selecionado"
                        description="Quando houver relatório salvo para esta data e owner, o resumo diário será preenchido automaticamente aqui."
                      />
                    ) : null}
                  </div>
                </HileSectionShell>
              </div>
            </div>

            <MovementSection
              trendSeries={controller.trendSeries}
              severitySnapshot={controller.severitySnapshot}
              totalMessagesDay={controller.overview?.overview.total_messages_day ?? 0}
              totalConversationsDay={controller.overview?.overview.conversations_total_analyzed_day ?? 0}
              sectionId="analysis-movimentacao"
              sectionNumber="03"
            />

            <div className="section reveal" id="analysis-conteudo">
              <div className="section-inner">
                <HileSectionShell
                  eyebrow="04"
                  title="Produtos e Contexto"
                  description="Produtos procurados e insights informativos do dia selecionado."
                >
                  <ProductsView
                    items={controller.productDemand}
                    selectedDate={controller.date}
                    informationalInsights={controller.informationalInsights}
                    contextInsights={controller.allInsights}
                    ownerScope={ownerScope}
                    showHeader={false}
                  />
                </HileSectionShell>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  if (activeView === "attendants") {
    return (
      <div className="settings-animated" key="attendants-view">
        <AttendantsView
          selectedDate={controller.date}
          summary={controller.attendantsPerformance}
          refreshHint={controller.lastRunAt}
          ownerScope={ownerScope}
          onSetOwnerScope={onSetOwnerScope}
        />
      </div>
    );
  }

  if (activeView === "dissatisfaction") {
    return (
      <div className="settings-animated" key="dissatisfaction-view">
        <div className="section reveal">
          <div className="section-inner">
            <div className="section-header">
              <span className="section-num">01</span>
              <div className="section-title">
                <h2>Insatisfação</h2>
                <p>
                  {dissatisfactionScope === "day"
                    ? `Visão do dia selecionado (${controller.date}).`
                    : "Visão geral consolidada de todas as execuções salvas."}
                </p>
              </div>
            </div>
          </div>
        </div>

        <section className="analysis-content-shell reveal">
          <article className="settings-card">
            <div className="settings-card-head">Escopo de insatisfação</div>
            <div className="settings-card-body">
              <div className="btn-group">
                <button
                  type="button"
                  className={`gap-chip ${dissatisfactionScope === "day" ? "active" : ""}`}
                  onClick={() => onSetDissatisfactionScope("day")}
                >
                  Insatisfação do dia
                </button>
                <button
                  type="button"
                  className={`gap-chip ${dissatisfactionScope === "overall" ? "active" : ""}`}
                  onClick={() => onSetDissatisfactionScope("overall")}
                >
                  Insatisfação geral
                </button>
              </div>
            </div>
          </article>
        </section>

        {dissatisfactionScope === "overall" ? (
          <DissatisfactionOverallView
            onOpenReportByContact={onOpenReportByContact}
            refreshHint={controller.lastRunAt}
            chatwootBaseUrl={controller.apiConfig?.chatwoot_base_url || ""}
            chatwootAccountId={Number(controller.apiConfig?.chatwoot_account_id || controller.overview?.account?.id || 0)}
            chatwootInboxId={Number(controller.apiConfig?.chatwoot_inbox_id || controller.overview?.inbox?.id || 0)}
            headerNumber="02"
          />
        ) : (
          <DissatisfactionView
            selectedDate={controller.date}
            alerts={controller.operationalAlerts}
            onOpenReportByContact={onOpenReportByContact}
            chatwootBaseUrl={controller.apiConfig?.chatwoot_base_url || ""}
            chatwootAccountId={Number(controller.apiConfig?.chatwoot_account_id || controller.overview?.account?.id || 0)}
            chatwootInboxId={Number(controller.apiConfig?.chatwoot_inbox_id || controller.overview?.inbox?.id || 0)}
            headerNumber="02"
          />
        )}
      </div>
    );
  }

  if (activeView === "products") {
    return (
      <div className="settings-animated" key="products-view">
        <ProductsDualView
          selectedDate={controller.date}
          dayItems={controller.productDemand}
          informationalInsights={controller.informationalInsights}
          refreshHint={controller.lastRunAt}
          ownerScope={ownerScope}
          onSetOwnerScope={onSetOwnerScope}
        />
      </div>
    );
  }

  if (activeView === "superadmin") {
    return (
      <div className="settings-animated" key="superadmin-view">
        <SuperadminAccountsView
          currentUserEmail={currentUser?.email || ""}
          currentUserRole={currentUser?.role || ""}
        />
      </div>
    );
  }

  return (
    <div className="settings-animated" key="settings-view">
      <SettingsView
        key={`settings-${currentUser?.email || "guest"}`}
        currentUser={currentUser || { name: "Usuário", email: "usuario@hile.com.br", role: "Operador" }}
        onUpdateProfile={onUpdateProfile}
      />
    </div>
  );
}


