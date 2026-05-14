import { NextResponse } from "next/server";
import { getAppConfig, requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

export async function GET() {
  const authResponse = await requireAuthorizedApiAccess();
  if (authResponse) return authResponse;

  const config = getAppConfig();
  return NextResponse.json({
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

