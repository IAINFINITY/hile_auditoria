export type ReportJobStatus = "running" | "completed" | "failed";

export type ReportJobEvent = {
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
};

export type ReportJobState = {
  job_id: string;
  date: string;
  status: ReportJobStatus;
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
  execution_order: ReportJobEvent[];
  result: unknown | null;
  error: string | null;
};

const REPORT_JOB_TTL_MS = 60 * 60 * 1000;

declare global {
  var __hileReportJobs: Map<string, ReportJobState> | undefined;
}

export function getReportJobsStore(): Map<string, ReportJobState> {
  if (!globalThis.__hileReportJobs) {
    globalThis.__hileReportJobs = new Map<string, ReportJobState>();
  }
  return globalThis.__hileReportJobs;
}

export function cleanupReportJobs(): void {
  const jobs = getReportJobsStore();
  const now = Date.now();

  for (const [jobId, job] of jobs.entries()) {
    const updatedAt = new Date(job.updated_at).getTime();
    if (Number.isNaN(updatedAt)) continue;
    if (now - updatedAt > REPORT_JOB_TTL_MS) {
      jobs.delete(jobId);
    }
  }
}
