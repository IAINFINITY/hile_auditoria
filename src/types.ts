export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface AccountInfo {
  id: number;
  name: string | null;
  role: string | null;
}

export interface InboxInfo {
  id: number;
  name: string | null;
  provider: string | null;
  channel_type: string | null;
  phone_number: string | null;
}

export interface TargetInfo {
  account: AccountInfo;
  inbox: InboxInfo;
}

export interface SystemCheckResponse {
  ok: boolean;
  checked_at: string;
  elapsed_ms: number;
  chatwoot: { ok: boolean; message?: string | null; target?: TargetInfo };
  dify: { ok: boolean; message?: string | null; code?: string | null; status?: number | null };
}

export interface RunStats {
  total_to_process: number;
  processed: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
}

export interface FailureItem {
  contact_key: string;
  contact?: { name?: string | null; identifier?: string | null };
  conversation_ids?: number[];
  error_status?: number | null;
  error_code?: string | null;
  error_message: string;
}

export interface InsightItem {
  id: string;
  severity: Severity;
  title: string;
  summary: string;
  conversation_id: number;
  contact_key: string;
  contact_name: string;
  finalization_status: "finalizada" | "continuada";
  finalization_reason: string;
  finalization_actor?: string | null;
  labels: string[];
  status: string | null;
  unread_count: number;
  last_interaction_at_local: string | null;
  trigger_after_1h_at_local: string | null;
}

export interface OverviewPayload {
  date: string;
  timezone: string;
  generated_at: string;
  account: AccountInfo;
  inbox: InboxInfo;
  overview: {
    conversations_scanned: number;
    conversations_entered_today: number;
    unique_contacts_today: number;
    conversations_total_analyzed_day: number;
    total_analysis_count: number;
    total_messages_day: number;
    repeated_identifier_count?: number;
    finalized_count: number;
    continued_count: number;
    trigger_ready_count: number;
    critical_insights_count: number;
    non_critical_insights_count: number;
    insights_total: number;
  };
  insights: InsightItem[];
  conversation_operational: Array<{
    conversation_id: number;
    contact_key: string;
    finalization_status: "finalizada" | "continuada";
    finalization_reason: string;
    finalization_actor?: string | null;
    waiting_on_agent?: boolean;
    waiting_on_customer?: boolean;
    pending_since_at?: number | null;
    pending_since_at_local?: string | null;
    last_interaction_at_local: string | null;
    trigger_after_1h_at_local: string | null;
    trigger_ready: boolean;
    minutes_overdue: number;
    message_count_day: number;
    unread_count: number;
    status: string | null;
    labels: string[];
    contact?: { name?: string | null; identifier?: string | null };
  }>;
}

export interface PreviewPayload {
  date: string;
  timezone: string;
  account: AccountInfo;
  inbox: InboxInfo;
  total_conversations_in_inbox_scan: number;
  conversations_entered_today: number;
  unique_contacts_today: number;
  contact_logs?: Array<{
    contact_key: string;
    contact?: { name?: string | null; identifier?: string | null };
    conversation_ids: number[];
    message_count_day: number;
  }>;
}

export interface AnalysisItem {
  analysis_index?: number;
  contact_key: string;
  contact?: { name?: string | null; identifier?: string | null };
  conversation_ids: number[];
  message_count_day: number;
  log_text?: string;
  conversation_operational?: Array<{
    conversation_id: number;
    state?: {
      finalization_status?: "finalizada" | "continuada";
      finalization_reason?: string;
      finalization_actor?: string | null;
      waiting_on_agent?: boolean;
      waiting_on_customer?: boolean;
      labels?: string[];
    } | null;
  }>;
  analysis?: {
    answer?: string | null;
  };
}

export interface RawAnalysisPayload {
  account?: AccountInfo;
  inbox?: InboxInfo;
  analyses?: AnalysisItem[];
  failures?: FailureItem[];
  run_stats?: RunStats;
}

export interface ReportPayload {
  date: string;
  account: AccountInfo;
  inbox: InboxInfo;
  report_markdown: string;
  summary: {
    conversations_entered_today: number;
    unique_contacts_today: number;
    total_to_process: number;
    processed: number;
    analyses_count: number;
    failures_count: number;
    critical_count: number;
    improvements_count: number;
    gaps_count: number;
    execution_order_count?: number;
  };
  execution_order?: Array<{
    sequence: number;
    total: number;
    contact_key: string;
    analysis_key: string | null;
    contact_name: string;
    conversation_ids: number[];
    success: boolean;
    processed: number;
    error_message?: string;
    error_code?: string | null;
  }>;
  raw_analysis: RawAnalysisPayload;
}

export interface ReportJobStartResponse {
  ok: boolean;
  job_id: string;
  status: "running";
  date: string;
}

export interface ReportJobStatusResponse {
  job_id: string;
  db_run_id?: string | null;
  date: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  updated_at: string;
  total: number;
  processed: number;
  current_contact: {
    sequence: number;
    total: number;
    contact_name: string;
    contact_key: string;
    analysis_key: string | null;
    conversation_ids: number[];
  } | null;
  execution_order: Array<{
    sequence: number;
    total: number;
    contact_key: string;
    analysis_key: string | null;
    contact_name: string;
    conversation_ids: number[];
    success: boolean;
    processed: number;
    error_message?: string;
    error_code?: string | null;
  }>;
  result: ReportPayload | null;
  error: string | null;
}

export interface ReportRunResponse {
  run: {
    id: string;
    status: "running" | "completed" | "failed";
    date_ref: string;
    started_at: string;
    finished_at: string | null;
  };
  report_markdown: string | null;
  report_json: Record<string, unknown> | null;
}

export interface ReportHistoryItem {
  id: string;
  status: "running" | "completed" | "failed";
  date_ref: string;
  started_at: string;
  finished_at: string | null;
  total_conversations: number;
  processed: number;
  success_count: number;
  failure_count: number;
  tenant: string;
  channel: string;
  has_report: boolean;
  report_json?: {
    date?: string;
    summary?: Record<string, unknown>;
    logs_count?: number;
    logs?: Array<{
      contact_key: string;
      contact_name: string;
      conversation_ids: number[];
      chatwoot_links: string[];
      risk_level: "critical" | "non_critical";
      summary: string | null;
      improvements: string[];
      next_steps: string[];
      finalization_status: string | null;
      finalization_actor: string | null;
      created_at: string;
    }>;
  } | null;
}

export interface ReportHistoryResponse {
  items: ReportHistoryItem[];
  count: number;
}

export interface AvailableDatesResponse {
  dates: string[];
  count: number;
}

export interface ReportByDateResponse {
  run: ReportHistoryItem & {
    report_markdown: string | null;
  };
}
