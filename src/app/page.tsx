"use client";

import { useState } from "react";
import { useDashboardController } from "@/features/dashboard/hooks/useDashboardController";
import { useRevealOnScroll } from "@/features/dashboard/hooks/useRevealOnScroll";
import { GapsSection } from "@/features/dashboard/sections/GapsSection";
import { InsightsSection } from "@/features/dashboard/sections/InsightsSection";
import { MetricsSection } from "@/features/dashboard/sections/MetricsSection";
import { MovementSection } from "@/features/dashboard/sections/MovementSection";
import { Navbar } from "@/features/dashboard/sections/Navbar";
import { ReportSection } from "@/features/dashboard/sections/ReportSection";

export default function Page() {
  useRevealOnScroll();
  const controller = useDashboardController();
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  async function handleConfirmRun() {
    setShowConfirmModal(false);
    await controller.executeOverview();
  }

  return (
    <>
      <Navbar navClass={controller.navClass} onNavigate={controller.navigateToSection} />

      <MetricsSection
        date={controller.date}
        setDate={controller.setDate}
        minDate={controller.minDate}
        maxDate={controller.maxDate}
        periodPreset={controller.periodPreset}
        applyPeriodPreset={controller.applyPeriodPreset}
        isBusy={controller.isBusy}
        isRunningOverview={controller.isRunningOverview}
        onRequestOverview={() => setShowConfirmModal(true)}
        lastRunAt={controller.lastRunAt}
        loading={Boolean(controller.loading)}
        systemCheck={controller.systemCheck}
        overview={controller.overview}
        severitySnapshot={controller.severitySnapshot}
        runTimeline={controller.runTimeline}
        runProgress={controller.runProgress}
        runCurrentContact={controller.runCurrentContact}
        selectedDateInfo={controller.selectedDateInfo}
        selectedDateHasSavedReport={controller.selectedDateHasSavedReport}
      />

      <GapsSection
        insightsReady={controller.insightsReady}
        criticalGapInsights={controller.criticalGapInsights}
        overview={controller.overview}
        chatwootBaseUrl={controller.apiConfig?.chatwoot_base_url || ""}
        onOpenReportByContact={controller.focusReportByContact}
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

      <MovementSection
        trendSeries={controller.trendSeries}
        severitySnapshot={controller.severitySnapshot}
        totalMessagesDay={controller.overview?.overview.total_messages_day ?? 0}
        totalConversationsDay={controller.overview?.overview.conversations_total_analyzed_day ?? 0}
      />

      <ReportSection
        criticalGapInsights={controller.criticalGapInsights}
        report={controller.report}
        reportHistory={controller.reportHistory}
        selectedReportContact={controller.selectedReportContact}
        onSelectReportContact={controller.setSelectedReportContact}
        reportSeverityFilter={controller.reportSeverityFilter}
        onChangeReportSeverityFilter={controller.setReportSeverityFilter}
      />

      <footer className="footer">
        <div className="footer-inner">Hilê Auditoria Inteligente - Sistema de monitoramento operacional</div>
      </footer>

      {showConfirmModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirmOverviewTitle">
          <div className="modal-card">
            <h3 id="confirmOverviewTitle">Executar overview agora?</h3>
            <p>Vamos checar conexões, buscar conversas do dia, rodar análise e atualizar o relatório.</p>
            {controller.selectedDateHasSavedReport ? (
              <p style={{ color: "var(--critical)" }}>
                Já existe relatório salvo para essa data. Se continuar, o novo relatório vai substituir o anterior.
              </p>
            ) : null}
            <div className="modal-actions">
              <button className="btn btn-sm" onClick={() => setShowConfirmModal(false)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={() => void handleConfirmRun()}>Confirmar e executar</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
