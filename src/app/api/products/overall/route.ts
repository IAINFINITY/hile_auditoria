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

function normalizeForMatch(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const PRODUCT_ALIASES: Record<string, string[]> = {
  Whey: ["whey", "uei", "wehy"],
  Creatina: ["creatina", "creatine", "creatin", "creatna"],
  "Pré-treino": ["pre treino", "pre-treino", "pretreino", "preworkout", "pré treino", "pré-treino"],
  Colageno: ["colageno", "colágeno", "collagen"],
  "Suplementos fitness": ["suplemento", "suplementos", "fitness"],
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
  return normalizeForMatch(collected.join(" "));
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

        for (const [canonicalName, aliases] of Object.entries(PRODUCT_ALIASES)) {
          if (!userText) continue;
          const matched = aliases.some((alias) => userText.includes(normalizeForMatch(alias)));
          if (!matched) continue;
          const name = normalizeProductName(canonicalName);
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
