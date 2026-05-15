import { NextResponse } from "next/server";
import { listClientsByDate } from "@/lib/server/audit/auditPersistence";
import { getAppConfig, parseDateInput, requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const config = getAppConfig();
    const { searchParams } = new URL(request.url);
    const inputDate = searchParams.get("date");
    const date = parseDateInput(inputDate, config.timezone);

    const payload = await listClientsByDate(date);
    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar os clientes.";
    return NextResponse.json({ error: "clients_fetch_failed", message }, { status: 400 });
  }
}
