import { RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import { parseJsonSafe } from "@/lib/server/audit/persistence/helpers";

export const runtime = "nodejs";

function normalizeProductName(value: string): string {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  return cleaned
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
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
    const limitInput = Number(searchParams.get("limit") || 300);
    const take = Number.isFinite(limitInput) && limitInput > 0 ? Math.min(1000, limitInput) : 300;

    const runs = await prisma.analysisRun.findMany({
      where: {
        status: RunStatus.completed,
        report: { isNot: null },
      },
      orderBy: { startedAt: "desc" },
      take,
      select: {
        dateRef: true,
        report: { select: { reportJson: true } },
      },
    });

    const counters = new Map<string, ProductCounter>();

    for (const run of runs) {
      const dateRef = run.dateRef.toISOString().slice(0, 10);
      const reportJson = (run.report?.reportJson as Record<string, unknown> | null) || null;
      const rawAnalysis = reportJson?.raw_analysis as Record<string, unknown> | undefined;
      const analyses = Array.isArray(rawAnalysis?.analyses) ? rawAnalysis?.analyses as Array<Record<string, unknown>> : [];

      for (const analysis of analyses) {
        const analysisObj = analysis && typeof analysis === "object" ? analysis : {};
        const contactKey = String((analysisObj as Record<string, unknown>).contact_key || "").trim();
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
          const name = normalizeProductName(rawName);
          if (!name || seenInAnalysis.has(name)) continue;
          seenInAnalysis.add(name);

          const current = counters.get(name) || {
            count: 0,
            contacts: new Set<string>(),
            days: new Set<string>(),
            lastSeenDate: null,
          };
          current.count += 1;
          if (contactKey) current.contacts.add(contactKey);
          current.days.add(dateRef);
          if (!current.lastSeenDate || dateRef > current.lastSeenDate) {
            current.lastSeenDate = dateRef;
          }
          counters.set(name, current);
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
      totalRuns: runs.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao carregar ranking de produtos.";
    return NextResponse.json({ error: "products_overall_failed", message }, { status: 400 });
  }
}

