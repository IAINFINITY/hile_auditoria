import { NextResponse, type NextRequest } from "next/server";
import { getAuthorizedUserContext } from "@/lib/auth/server";
import { createProxySupabaseClient, readRequestAuthUser } from "@/lib/supabase/server";

const PUBLIC_API_PATHS = new Set<string>([
  "/api/health",
  "/api/auth/health",
  "/api/auth/status",
  "/api/report-day/auto-sync",
]);

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PATHS.has(pathname);
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  if (!pathname.startsWith("/api/")) {
    return response;
  }

  if (isPublicApiPath(pathname)) {
    return response;
  }

  try {
    const responseRef = { current: response };
    const supabase = createProxySupabaseClient(request, responseRef);
    const { user, error } = await readRequestAuthUser(supabase);
    response = responseRef.current;

    if (error || !user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Faça login para acessar esta rota." },
        { status: 401 },
      );
    }

    const access = await getAuthorizedUserContext(supabase, { id: user.id, email: user.email || null });
    if (!access.authorized) {
      return NextResponse.json(
        { error: "forbidden", message: "Este usuário não possui permissão para o painel." },
        { status: 403 },
      );
    }

    return response;
  } catch {
    return NextResponse.json(
      { error: "auth_proxy_unavailable", message: "Falha temporaria ao validar sua sessao." },
      { status: 503 },
    );
  }
}

export const config = {
  matcher: ["/api/:path*"],
};
