import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { assertRequiredConfig, getConfig, loadEnvFile } from "./config";
import {
  buildDailyConversationLogs,
  buildDailyOverview,
  buildDailyReport,
  discoverChatwootTarget,
  runDailyAnalysis,
} from "./auditService";
import { createDifyClient } from "./difyClient";
import { assertYmd, todayYmd } from "./dateUtils";

loadEnvFile();

const config = getConfig();
assertRequiredConfig(config);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexHtmlPath = path.resolve(__dirname, "..", "public", "index.html");
const frontendDistDir = path.resolve(__dirname, "..", "client", "dist");
const frontendIndexPath = path.resolve(frontendDistDir, "index.html");
type ReportJobStatus = "running" | "completed" | "failed";
type ReportJobEvent = {
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

type ReportJobState = {
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
  result: any | null;
  error: string | null;
};

const reportJobs = new Map<string, ReportJobState>();
const REPORT_JOB_TTL_MS = 60 * 60 * 1000;

function cleanupReportJobs() {
  const now = Date.now();
  for (const [jobId, job] of reportJobs.entries()) {
    const updatedAt = new Date(job.updated_at).getTime();
    if (Number.isNaN(updatedAt)) continue;
    if (now - updatedAt > REPORT_JOB_TTL_MS) {
      reportJobs.delete(jobId);
    }
  }
}

function contentTypeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".ico") return "image/x-icon";
  if (extension === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendHtml(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function tryServeFrontendAsset(req, res) {
  if (!req.url || req.method !== "GET") return false;
  if (req.url.startsWith("/api/") || req.url === "/health") return false;

  const requestPath = req.url.split("?")[0];
  const sanitized = requestPath.replace(/^\/+/, "");
  const targetPath = path.resolve(frontendDistDir, sanitized);

  if (!targetPath.startsWith(frontendDistDir)) return false;
  if (!existsSync(targetPath)) return false;

  try {
    const buffer = readFileSync(targetPath);
    res.writeHead(200, {
      "Content-Type": contentTypeFromPath(targetPath),
      "Content-Length": buffer.byteLength,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    res.end(buffer);
    return true;
  } catch {
    return false;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);

  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Body JSON inválido.");
  }
}

function parseDateFromRequest(inputDate) {
  const date = inputDate || todayYmd(config.timezone);
  assertYmd(date);
  return date;
}

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - startedAt;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} -> ${res.statusCode} (${ms} ms)`);
  });

  if (req.method === "GET" && req.url === "/") {
    try {
      const activeIndexPath = existsSync(frontendIndexPath) ? frontendIndexPath : indexHtmlPath;
      const content = readFileSync(activeIndexPath, "utf8");
      return sendHtml(res, 200, content);
    } catch {
      return sendJson(res, 500, {
        error: "ui_unavailable",
        message: "Não foi possível carregar o frontend.",
      });
    }
  }

  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { ok: true, service: "auditoria-atendimento-hile" });
  }

  if (req.method === "GET" && req.url === "/api/config") {
    return sendJson(res, 200, {
      timezone: config.timezone,
      chatwoot_base_url: config.chatwoot.baseUrl,
      chatwoot_group_name: config.chatwoot.groupName,
      chatwoot_account_id: config.chatwoot.accountId,
      chatwoot_inbox_name: config.chatwoot.inboxName,
      chatwoot_inbox_id: config.chatwoot.inboxId,
      chatwoot_inbox_provider: config.chatwoot.inboxProvider,
      dify_mode: config.dify.mode,
      dify_base_url: config.dify.baseUrl,
    });
  }

  if (req.method === "GET" && req.url === "/api/chatwoot/target") {
    try {
      const output = await discoverChatwootTarget({ config });
      return sendJson(res, 200, output);
    } catch (error) {
      return sendJson(res, 400, {
        error: "target_discovery_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "GET" && req.url === "/api/system-check") {
    const started = Date.now();
    const result: any = {
      ok: true,
      checked_at: new Date().toISOString(),
      chatwoot: { ok: false, message: null },
      dify: { ok: false, message: null },
      elapsed_ms: 0,
    };

    try {
      const target = await discoverChatwootTarget({ config });
      result.chatwoot = { ok: true, target };
    } catch (error) {
      result.ok = false;
      result.chatwoot = { ok: false, message: error.message };
    }

    try {
      const difyClient = createDifyClient(config.dify);
      const health = await difyClient.testConnection();
      if (!health.ok) {
        result.ok = false;
      }
      result.dify = health;
    } catch (error) {
      result.ok = false;
      result.dify = { ok: false, message: error.message };
    }

    result.elapsed_ms = Date.now() - started;
    return sendJson(res, result.ok ? 200 : 207, result);
  }

  if (req.method === "POST" && req.url === "/api/preview-day") {
    try {
      const body = await readJsonBody(req);
      const date = parseDateFromRequest(body?.date);
      const output = await buildDailyConversationLogs({ config, date });
      return sendJson(res, 200, output);
    } catch (error) {
      return sendJson(res, 400, {
        error: "preview_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "POST" && req.url === "/api/overview-day") {
    try {
      const body = await readJsonBody(req);
      const date = parseDateFromRequest(body?.date);
      const output = await buildDailyOverview({ config, date });
      return sendJson(res, 200, output);
    } catch (error) {
      return sendJson(res, 400, {
        error: "overview_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "POST" && req.url === "/api/analyze-day") {
    try {
      const body = await readJsonBody(req);
      const date = parseDateFromRequest(body?.date);
      const output = await runDailyAnalysis({ config, date });
      return sendJson(res, 200, output);
    } catch (error) {
      return sendJson(res, 400, {
        error: "analysis_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "POST" && req.url === "/api/report-day") {
    try {
      const body = await readJsonBody(req);
      const date = parseDateFromRequest(body?.date);
      const output = await buildDailyReport({ config, date });
      return sendJson(res, 200, output);
    } catch (error) {
      return sendJson(res, 400, {
        error: "report_failed",
        message: error.message,
      });
    }
  }


  if (req.method === "POST" && req.url === "/api/report-day/start") {
    try {
      cleanupReportJobs();
      const body = await readJsonBody(req);
      const date = parseDateFromRequest(body?.date);
      const jobId = randomUUID();
      const now = new Date().toISOString();
      const initialJob: ReportJobState = {
        job_id: jobId,
        date,
        status: "running",
        started_at: now,
        updated_at: now,
        total: 0,
        processed: 0,
        current_contact: null,
        execution_order: [],
        result: null,
        error: null,
      };
      reportJobs.set(jobId, initialJob);

      (async () => {
        try {
          const output = await buildDailyReport({
            config,
            date,
            onProgress: (event: any) => {
              const state = reportJobs.get(jobId);
              if (!state) return;

              state.updated_at = new Date().toISOString();
              state.total = Number(event?.total || state.total || 0);

              if (event?.type === "contact_start") {
                state.current_contact = {
                  sequence: Number(event?.sequence || 0),
                  total: Number(event?.total || state.total || 0),
                  contact_name: String(event?.contact_name || event?.contact_key || "Contato"),
                  contact_key: String(event?.contact_key || ""),
                  analysis_key: event?.analysis_key ? String(event.analysis_key) : null,
                  conversation_ids: Array.isArray(event?.conversation_ids) ? event.conversation_ids : [],
                };
                return;
              }

              if (event?.type === "contact_done") {
                state.processed = Number(event?.processed || state.processed || 0);
                state.execution_order.push({
                  sequence: Number(event?.sequence || state.execution_order.length + 1),
                  total: Number(event?.total || state.total || 0),
                  contact_key: String(event?.contact_key || ""),
                  analysis_key: event?.analysis_key ? String(event.analysis_key) : null,
                  contact_name: String(event?.contact_name || event?.contact_key || "Contato"),
                  conversation_ids: Array.isArray(event?.conversation_ids) ? event.conversation_ids : [],
                  success: Boolean(event?.success),
                  processed: Number(event?.processed || state.processed || 0),
                  error_message: event?.error_message ? String(event.error_message) : undefined,
                  error_code: event?.error_code ? String(event.error_code) : null,
                });
                state.current_contact = null;
              }
            },
          });

          const state = reportJobs.get(jobId);
          if (!state) return;
          state.status = "completed";
          state.updated_at = new Date().toISOString();
          state.result = {
            ...output,
            summary: {
              ...output.summary,
              execution_order_count: state.execution_order.length,
            },
            execution_order: state.execution_order,
          };
          state.error = null;
          state.current_contact = null;
        } catch (error: any) {
          const state = reportJobs.get(jobId);
          if (!state) return;
          state.status = "failed";
          state.updated_at = new Date().toISOString();
          state.error = error?.message || "Falha ao gerar relatório.";
          state.current_contact = null;
        }
      })();

      return sendJson(res, 202, { ok: true, job_id: jobId, status: "running", date });
    } catch (error: any) {
      return sendJson(res, 400, {
        error: "report_start_failed",
        message: error?.message || "Não foi possível iniciar o relatório.",
      });
    }
  }

  if (req.method === "GET" && req.url?.startsWith("/api/report-day/status")) {
    try {
      cleanupReportJobs();
      const url = new URL(req.url, "http://localhost");
      const jobId = String(url.searchParams.get("job_id") || "").trim();
      if (!jobId) {
        return sendJson(res, 400, {
          error: "invalid_param",
          message: "Parâmetro job_id é obrigatório.",
        });
      }

      const state = reportJobs.get(jobId);
      if (!state) {
        return sendJson(res, 404, {
          error: "job_not_found",
          message: "Job não encontrado ou expirado.",
        });
      }

      return sendJson(res, 200, state);
    } catch (error: any) {
      return sendJson(res, 400, {
        error: "report_status_failed",
        message: error?.message || "Não foi possível consultar o status do relatório.",
      });
    }
  }

  if (tryServeFrontendAsset(req, res)) {
    return;
  }

  return sendJson(res, 404, {
    error: "not_found",
    message:
      "Use GET /, GET /health, GET /api/config, GET /api/chatwoot/target, GET /api/system-check, POST /api/preview-day, POST /api/overview-day, POST /api/analyze-day, POST /api/report-day, POST /api/report-day/start ou GET /api/report-day/status?job_id=...",
  });
});

server.listen(config.port, () => {
  console.log(`Servidor online em http://localhost:${config.port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE") {
    throw error;
  }

  const isDev = process.env.NODE_ENV !== "production";
  if (!isDev) {
    throw error;
  }

  console.warn(
    `[dev] Porta ${config.port} ja esta em uso. Mantendo este processo ativo e reutilizando a API que ja esta rodando nessa porta.`,
  );
  console.warn(
    "[dev] Se quiser iniciar uma nova instancia da API, finalize o processo antigo primeiro ou rode com outra porta (PowerShell: $env:PORT=3002; npm run dev:api).",
  );

  // Mantém o processo vivo no modo watch para não derrubar o `npm run dev` com concurrently.
  setInterval(() => {}, 1 << 30);
});







