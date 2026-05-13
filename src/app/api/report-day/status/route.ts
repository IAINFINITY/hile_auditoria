import { NextResponse } from "next/server";
import { cleanupReportJobs, getReportJobsStore } from "@/lib/server/reportJobs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    cleanupReportJobs();

    const { searchParams } = new URL(request.url);
    const jobId = String(searchParams.get("job_id") || "").trim();

    if (!jobId) {
      return NextResponse.json(
        { error: "invalid_param", message: "Parâmetro job_id é obrigatório." },
        { status: 400 },
      );
    }

    const jobs = getReportJobsStore();
    const state = jobs.get(jobId);

    if (!state) {
      return NextResponse.json(
        { error: "job_not_found", message: "Job não encontrado ou expirado." },
        { status: 404 },
      );
    }

    return NextResponse.json(state);
  } catch (error: any) {
    return NextResponse.json(
      { error: "report_status_failed", message: error?.message || "Não foi possível consultar o status do relatório." },
      { status: 400 },
    );
  }
}
