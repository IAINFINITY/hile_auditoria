import { RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import { parseJsonSafe } from "@/lib/server/audit/persistence/helpers";
import { enforceOwnerBucketByInbox, sanitizeBreakdownByInbox } from "@/lib/server/audit/ownerBuckets";
import { canonicalizeProductLabel, normalizeProductForMatch } from "@/lib/products/canonical";

export const runtime = "nodejs";

function normalizeOwnerScope(value: string | null): "all" | "ia" | "suellen" | "samuel" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ia" || normalized === "suellen" || normalized === "samuel") return normalized;
  return "all";
}

function resolveOwnerBucketFromTracking(analysisObj: Record<string, unknown>): "ia" | "suellen" | "samuel" {
  const tracking = (analysisObj.responsible_tracking as Record<string, unknown> | undefined) || undefined;
  const trackingInboxId = Number(tracking?.source_inbox_id || analysisObj.inbox_id || 0) || null;
  const directRaw = String(tracking?.owner_bucket || "").trim().toLowerCase();
  if (directRaw === "ia" || directRaw === "suellen" || directRaw === "samuel") {
    return enforceOwnerBucketByInbox(directRaw, trackingInboxId);
  }

  const breakdown = sanitizeBreakdownByInbox(tracking?.message_breakdown, trackingInboxId);
  const iaCount = Number(breakdown.ia || 0);
  const suellenCount = Number(breakdown.suellen || 0);
  const samuelCount = Number(breakdown.samuel || 0);
  const ranked = [
    { key: "ia" as const, count: iaCount },
    { key: "suellen" as const, count: suellenCount },
    { key: "samuel" as const, count: samuelCount },
  ].sort((a, b) => b.count - a.count);
  if (ranked[0]?.count > 0) return ranked[0].key;

  return "ia";
}

const PRODUCT_ALIASES: Record<string, string[]> = {
  "Whey Protein": ["whey", "uei", "wehy", "whey protein"],
  Creatina: ["creatina", "creatine", "creatin", "creatna", "creatina monohidratada"],
  "Pre-treino": ["pre treino", "pre-treino", "pretreino", "preworkout", "pre treino", "pre-treino"],
  Colageno: ["colageno", "colageno", "collagen"],
  "Suplementos Fitness": ["suplementos fitness", "suplemento fitness"],
};

function extractUserLogText(logText: string): string {
  const lines = String(logText || "").split("\n");
  const collected: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const explicitUser = line.match(/^\[(.*?)\]\s*(?:\[[^\]]+\]\s*)?(USER|USUARIO|CLIENTE|CONTACT)[^:]*[:\-]\s*(.*)$/i);
    if (explicitUser?.[3]) {
      collected.push(explicitUser[3]);
      continue;
    }
    const compactUser = line.match(/^(USER|USUARIO|CLIENTE|CONTACT)[^:]*[:\-]\s*(.*)$/i);
    if (compactUser?.[2]) {
      collected.push(compactUser[2]);
    }
  }
  return normalizeProductForMatch(collected.join(" "));
}

type ProductCounter = {
  count: number;
  contacts: Set<string>;
  days: Set<string>;
  lastSeenDate: string | null;
};

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const takeInput = Number(searchParams.get("take") || searchParams.get("limit") || 300);
    const pageInput = Number(searchParams.get("page") || 1);
    const ownerScope = normalizeOwnerScope(searchParams.get("owner"));
    const take = Number.isFinite(takeInput) && takeInput > 0 ? Math.min(1000, takeInput) : 300;
    const page = Number.isFinite(pageInput) && pageInput > 0 ? Math.floor(pageInput) : 1;
    const skip = (page - 1) * take;
    const from = String(searchParams.get("from") || "").trim();
    const to = String(searchParams.get("to") || "").trim();
    const dateRefWhere: { gte?: Date; lte?: Date } = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) dateRefWhere.gte = new Date(`${from}T00:00:00.000Z`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) dateRefWhere.lte = new Date(`${to}T23:59:59.999Z`);

    const where = {
      status: RunStatus.completed,
      report: { isNot: null },
      ...(dateRefWhere.gte || dateRefWhere.lte ? { dateRef: dateRefWhere } : {}),
    };

    const runs = await prisma.analysisRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip,
      take,
      select: {
        dateRef: true,
        report: { select: { reportJson: true } },
      },
    });
    const totalRuns = await prisma.analysisRun.count({ where });

    const counters = new Map<string, ProductCounter>();

    for (const run of runs) {
      const dateRef = run.dateRef.toISOString().slice(0, 10);
      const reportJson = (run.report?.reportJson as Record<string, unknown> | null) || null;
      const rawAnalysis = reportJson?.raw_analysis as Record<string, unknown> | undefined;
      const analyses = Array.isArray(rawAnalysis?.analyses) ? (rawAnalysis?.analyses as Array<Record<string, unknown>>) : [];

      for (const analysis of analyses) {
        const analysisObj = analysis && typeof analysis === "object" ? analysis : {};
        const ownerBucket = resolveOwnerBucketFromTracking(analysisObj);
        if (ownerScope !== "all" && ownerBucket !== ownerScope) continue;
        const contactKey = String((analysisObj as Record<string, unknown>).contact_key || "").trim();
        const logText = String((analysisObj as Record<string, unknown>).log_text || "");
        const userText = extractUserLogText(logText);
        const answerRaw = String(
          ((analysisObj as Record<string, unknown>).analysis as Record<string, unknown> | undefined)?.answer || "",
        );
        const parsed = parseJsonSafe(answerRaw);
        const productsRaw = Array.isArray(parsed.produtos_citados)
          ? (parsed.produtos_citados as Array<Record<string, unknown>>)
          : [];

        const seenInAnalysis = new Set<string>();
        for (const product of productsRaw) {
          const rawName = String(product?.nome_produto || product?.termo_detectado || "").trim();
          const label = canonicalizeProductLabel(rawName);
          const key = normalizeProductForMatch(label);
          if (!key || seenInAnalysis.has(key)) continue;
          seenInAnalysis.add(key);

          const current = counters.get(label) || {
            count: 0,
            contacts: new Set<string>(),
            days: new Set<string>(),
            lastSeenDate: null,
          };
          current.count += 1;
          if (contactKey) current.contacts.add(contactKey);
          current.days.add(dateRef);
          if (!current.lastSeenDate || dateRef > current.lastSeenDate) current.lastSeenDate = dateRef;
          counters.set(label, current);
        }

        for (const [canonicalName, aliases] of Object.entries(PRODUCT_ALIASES)) {
          if (!userText) continue;
          const matched = aliases.some((alias) => userText.includes(normalizeProductForMatch(alias)));
          if (!matched) continue;

          const label = canonicalizeProductLabel(canonicalName);
          const key = normalizeProductForMatch(label);
          if (!key || seenInAnalysis.has(key)) continue;
          seenInAnalysis.add(key);

          const current = counters.get(label) || {
            count: 0,
            contacts: new Set<string>(),
            days: new Set<string>(),
            lastSeenDate: null,
          };
          current.count += 1;
          if (contactKey) current.contacts.add(contactKey);
          current.days.add(dateRef);
          if (!current.lastSeenDate || dateRef > current.lastSeenDate) current.lastSeenDate = dateRef;
          counters.set(label, current);
        }
      }
    }

    const items = Array.from(counters.entries())
      .map(([name, info]) => ({
        name,
        count: info.count,
        contacts: info.contacts.size,
        days: info.days.size,
        lastSeenDate: info.lastSeenDate,
      }))
      .sort((a, b) => b.count - a.count || b.contacts - a.contacts || a.name.localeCompare(b.name, "pt-BR"));

    return NextResponse.json({
      items,
      owner_scope: ownerScope,
      totalRuns: runs.length,
      totalRunsAvailable: totalRuns,
      pagination: {
        page,
        take,
        total_pages: Math.max(1, Math.ceil(totalRuns / take)),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao carregar ranking de produtos.";
    return NextResponse.json({ error: "products_overall_failed", message }, { status: 400 });
  }
}
