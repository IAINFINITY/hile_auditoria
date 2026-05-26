import { NextResponse } from "next/server";
import { listClientsByDate } from "@/lib/server/audit/auditPersistence";
import { getAppConfig, parseDateInput, requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

function normalizeOwnerScope(value: string | null): "all" | "ia" | "suellen" | "samuel" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ia" || normalized === "suellen" || normalized === "samuel") return normalized;
  return "all";
}

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const config = getAppConfig();
    const { searchParams } = new URL(request.url);
    const inputDate = searchParams.get("date");
    const owner = normalizeOwnerScope(searchParams.get("owner"));
    const date = parseDateInput(inputDate, config.timezone);

    const payload = await listClientsByDate(date);
    if (owner === "all") return NextResponse.json(payload);
    return NextResponse.json({
      ...payload,
      items: (payload.items || []).filter((item) => String(item.responsibleBucket || "ia") === owner),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar os clientes.";
    return NextResponse.json({ error: "clients_fetch_failed", message }, { status: 400 });
  }
}
