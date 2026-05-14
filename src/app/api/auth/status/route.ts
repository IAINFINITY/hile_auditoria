import { NextResponse } from "next/server";
import { getIsAuthorizedUser } from "@/lib/auth/server";
import { createRouteHandlerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = await createRouteHandlerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json(
        { authenticated: false, authorized: false, user: null },
        { status: 401 },
      );
    }

    const authorized = await getIsAuthorizedUser(supabase, user.id);
    return NextResponse.json({
      authenticated: true,
      authorized,
      user: {
        id: user.id,
        email: user.email || null,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to validate auth status.";
    return NextResponse.json(
      { authenticated: false, authorized: false, user: null, message },
      { status: 500 },
    );
  }
}

