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
import { ReportSection } from "@/features/dashboard/sections/dashboard/ReportSection";
import { SettingsView } from "@/features/dashboard/sections/settings/SettingsView";
import type { DashboardController } from "../dashboardTypes";
import type { AppView } from "../types";

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
  onSetAnalysisScope: (scope: "day" | "overall") => void;
  onSetDissatisfactionScope: (scope: "day" | "overall") => void;
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
  onSetAnalysisScope,
  onSetDissatisfactionScope,
  onUpdateProfile,
}: MainContentRendererProps) {
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

        <ReportSection
          criticalGapInsights={controller.criticalGapInsights}
          report={controller.report}
          reportHistory={controller.reportHistory}
          selectedReportContact={controller.selectedReportContact}
          onSelectReportContact={controller.setSelectedReportContact}
          reportSeverityFilter={controller.reportSeverityFilter}
          onChangeReportSeverityFilter={controller.setReportSeverityFilter}
          selectedDate={controller.date}
          periodPreset={controller.periodPreset}
        />
      </div>
    );
  }

  if (activeView === "clients") {
    return (
      <div className="settings-animated" key="clients-view">
        <AccountsView selectedDate={clientsSnapshotDate} knownRunId={selectedDateKnownRunId} refreshHint={controller.lastRunAt} />
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
            <div className="section-header">
              <span className="section-num">01</span>
              <div className="section-title">
                <h2>Análise</h2>
                <p>
                  {analysisScope === "day"
                    ? `Visão do dia selecionado (${controller.date}).`
                    : "Visão geral consolidada de todas as execuções salvas."}
                </p>
              </div>
            </div>
          </div>
        </div>

        <section className="analysis-content-shell reveal">
          <article className="settings-card">
            <div className="settings-card-head">Escopo da análise</div>
            <div className="settings-card-body">
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
            </div>
          </article>
        </section>

        {analysisScope === "overall" ? (
          <AnalysisOverallView refreshHint={controller.lastRunAt} />
        ) : (
          <>
            <div className="section reveal" id="analysis-overview">
              <div className="section-inner">
                <div className="section-header">
                  <span className="section-num">01</span>
                  <div className="section-title">
                    <h2>Análise Geral do Dia</h2>
                    <p>Esta análise geral reflete exatamente os dados do dia selecionado: {controller.date}.</p>
                  </div>
                </div>
              </div>
            </div>

            <section className="analysis-content-shell reveal">
              <article className="settings-card">
                <div className="settings-card-head">Como interpretar esta análise</div>
                <div className="settings-card-body">
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
              </article>
            </section>

            <MovementSection
              trendSeries={controller.trendSeries}
              severitySnapshot={controller.severitySnapshot}
              totalMessagesDay={controller.overview?.overview.total_messages_day ?? 0}
              totalConversationsDay={controller.overview?.overview.conversations_total_analyzed_day ?? 0}
              sectionId="analysis-movimentacao"
              sectionNumber="02"
            />

            <div className="section reveal" id="analysis-conteudo">
              <div className="section-inner">
                <div className="section-header">
                  <span className="section-num">03</span>
                  <div className="section-title">
                    <h2>Produtos e Contexto</h2>
                    <p>Produtos procurados e insights informativos do dia selecionado</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <ProductsView
                items={controller.productDemand}
                selectedDate={controller.date}
                informationalInsights={controller.informationalInsights}
                contextInsights={controller.allInsights}
                showHeader={false}
              />
            </div>
          </>
        )}
      </div>
    );
  }

  if (activeView === "attendants") {
    return (
      <div className="settings-animated" key="attendants-view">
        <AttendantsView selectedDate={controller.date} summary={controller.attendantsPerformance} refreshHint={controller.lastRunAt} />
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
          <DissatisfactionOverallView onOpenReportByContact={controller.focusReportByContact} refreshHint={controller.lastRunAt} />
        ) : (
          <DissatisfactionView
            selectedDate={controller.date}
            alerts={controller.operationalAlerts}
            onOpenReportByContact={controller.focusReportByContact}
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
        />
      </div>
    );
  }

  return (
    <div className="settings-animated" key="settings-view">
      <SettingsView
        currentUser={currentUser || { name: "Usuário", email: "usuario@hile.com.br", role: "Operador" }}
        onUpdateProfile={onUpdateProfile}
      />
    </div>
  );
}
