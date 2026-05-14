import { NextResponse, type NextRequest } from "next/server";
import { getIsAuthorizedUser } from "@/lib/auth/server";
import { createProxySupabaseClient } from "@/lib/supabase/server";

const PUBLIC_API_PATHS = new Set<string>(["/api/health"]);

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

  const responseRef = { current: response };
  const supabase = createProxySupabaseClient(request, responseRef);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  response = responseRef.current;

  if (error || !user) {
    return NextResponse.json(
      { error: "unauthorized", message: "Faça login para acessar esta rota." },
      { status: 401 },
    );
  }

  const authorized = await getIsAuthorizedUser(supabase, user.id);
  if (!authorized) {
    return NextResponse.json(
      { error: "forbidden", message: "Este usuário não possui permissão para o painel." },
      { status: 403 },
    );
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};

