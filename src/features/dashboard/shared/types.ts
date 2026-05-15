import type {
  FailureItem,
  InsightItem,
  OverviewPayload,
  ReportHistoryItem,
  ReportPayload,
  Severity,
  SystemCheckResponse,
} from "../../../types";

export type ActionKey = "overview";
export type InsightFilter = "all" | Severity;
export type PeriodPreset = "today" | "yesterday" | "before_yesterday" | "week" | "month" | "year";
export type OverviewExecutionMode = "reuse" | "force";

export interface ApiConfigPayload {
  timezone: string;
  chatwoot_base_url?: string;
  chatwoot_group_name?: string;
  chatwoot_account_id?: number | null;
  chatwoot_inbox_name?: string;
  chatwoot_inbox_id?: number | null;
  chatwoot_inbox_provider?: string;
  dify_mode?: string;
  dify_base_url?: string;
}

export type SeveritySnapshot = Record<Severity, number>;

export interface MetricCard {
  label: string;
  value: number | string;
  tone: string;
}

export interface RiskRow {
  key: Severity;
  label: string;
  count: number;
  pct: string;
}

export interface ReportLinkItem {
  label: string;
  url: string;
}

export interface DashboardController {
  date: string;
  setDate: (value: string) => void;
  minDate: string;
  maxDate: string;
  periodPreset: PeriodPreset;
  applyPeriodPreset: (value: PeriodPreset) => void;
  status: string;
  loading: ActionKey | null;
  isBusy: boolean;
  isRunningOverview: boolean;
  lastRunAt: string | null;
  activeNav: string;
  navClass: (section: string) => string;
  navigateToSection: (section: string) => void;
  executeOverview: (mode?: OverviewExecutionMode) => Promise<void>;
  overviewExecutionMode: OverviewExecutionMode;
  setOverviewExecutionMode: (mode: OverviewExecutionMode) => void;
  apiConfig: ApiConfigPayload | null;
  systemCheck: SystemCheckResponse | null;
  overview: OverviewPayload | null;
  report: ReportPayload | null;
  failures: FailureItem[];
  filteredFailures: FailureItem[];
  insightsReady: boolean;
  insightFilter: InsightFilter;
  setInsightFilter: (value: InsightFilter) => void;
  insightsPage: number;
  totalInsightPages: number;
  setInsightsPage: (value: number) => void;
  filteredInsights: InsightItem[];
  allInsights: InsightItem[];
  criticalGapInsights: InsightItem[];
  visibleInsights: InsightItem[];
  insightsPageSize: number;
  severitySnapshot: SeveritySnapshot;
  metricCards: MetricCard[];
  panoramaExtra: string;
  gaugeData: { current: number; total: number };
  showTrend: boolean;
  trendSeries: Array<{ label: string; conversas: number; ia: number; usuario: number }>;
  riskRows: { rows: RiskRow[]; total: number };
  reportContacts: string[];
  selectedReportContact: string | null;
  setSelectedReportContact: (value: string | null) => void;
  reportSeverityFilter: "all" | "critical" | "high" | "medium" | "low" | "info";
  setReportSeverityFilter: (value: "all" | "critical" | "high" | "medium" | "low" | "info") => void;
  filteredReportMarkdown: string;
  rawOutput: string;
  overviewRunCount: number;
  runTimeline: string[];
  runProgress: number;
  runCurrentContact: string | null;
  reportLinks: ReportLinkItem[];
  reportHistory: ReportHistoryItem[];
  selectedDateInfo: string;
  selectedDateHasSavedReport: boolean;
  focusReportByContact: (contactName: string) => void;
}
