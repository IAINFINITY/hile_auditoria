import { NextResponse } from "next/server";
import { getAuthorizedUserContext, registerAuthAuditEvent } from "@/lib/auth/server";
import { createRouteHandlerSupabaseClient, readRequestAuthUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = await createRouteHandlerSupabaseClient();
    const { user, error } = await readRequestAuthUser(supabase);

    if (error || !user) {
      return NextResponse.json({ authenticated: false, authorized: false, user: null }, { status: 401 });
    }

    const access = await getAuthorizedUserContext(supabase, { id: user.id, email: user.email || null });
    if (!access.authorized || !access.role) {
      await registerAuthAuditEvent({
        actorUserId: user.id,
        actorEmail: user.email || null,
        actorRole: null,
        eventType: "auth_status_denied",
        outcome: "denied",
        reason: access.reason || "not_authorized",
      });
      return NextResponse.json(
        {
          authenticated: true,
          authorized: false,
          user: {
            id: user.id,
            email: user.email || null,
            role: null,
          },
        },
        { status: 403 },
      );
    }

    return NextResponse.json({
      authenticated: true,
      authorized: true,
      user: {
        id: user.id,
        email: user.email || null,
        role: access.role,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to validate auth status.";
    return NextResponse.json({ authenticated: false, authorized: false, user: null, message }, { status: 500 });
  }
}
