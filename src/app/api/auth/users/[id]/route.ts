import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { registerAuthAuditEvent } from "@/lib/auth/server";
import { consumeRateLimit, getRequestIp, getRequestUserAgent, isSameOriginRequest } from "@/lib/auth/security";
import { requireRole } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

function shouldEnforceOriginCheck(): boolean {
  return process.env.AUTH_ENFORCE_ORIGIN_CHECK !== "false";
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole("superadmin");
  if (auth.response) return auth.response;

  if (shouldEnforceOriginCheck() && !isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "invalid_origin", message: "Origem invalida para esta operacao." },
      { status: 403 },
    );
  }

  const ip = getRequestIp(request);
  const rate = consumeRateLimit({
    key: `auth_users_patch:${ip}:${auth.user?.id || "anonymous"}`,
    maxAttempts: 20,
    windowMs: 10 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: `Muitas tentativas. Tente novamente em ${rate.retryAfterSec}s.` },
      { status: 429 },
    );
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const nextDisplayName = body.displayName === undefined ? undefined : String(body.displayName || "").trim() || null;
  const nextRoleRaw = body.role === undefined ? undefined : String(body.role || "").trim().toLowerCase();
  const nextActiveRaw = body.active === undefined ? undefined : Boolean(body.active);

  const target = await prisma.allowedUser.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "not_found", message: "Usuario nao encontrado." }, { status: 404 });
  }

  if (target.role === "superadmin") {
    const tryingRoleChange = nextRoleRaw !== undefined && nextRoleRaw !== "superadmin";
    const tryingDeactivate = nextActiveRaw === false;
    if (tryingRoleChange || tryingDeactivate) {
      return NextResponse.json(
        {
          error: "protected_superadmin",
          message: "Nao e permitido remover ou desativar o superadmin por esta rota.",
        },
        { status: 400 },
      );
    }
  }

  if (nextRoleRaw !== undefined && nextRoleRaw !== "admin" && nextRoleRaw !== "superadmin") {
    return NextResponse.json(
      { error: "invalid_role", message: "Role invalido. Use admin ou superadmin." },
      { status: 400 },
    );
  }

  if (nextRoleRaw === "superadmin" && target.role !== "superadmin") {
    return NextResponse.json(
      {
        error: "role_not_allowed",
        message: "Promocao para superadmin deve ser feita por procedimento manual controlado.",
      },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  if (nextDisplayName !== undefined) data.displayName = nextDisplayName;
  if (nextRoleRaw !== undefined) data.role = nextRoleRaw;
  if (nextActiveRaw !== undefined) data.active = nextActiveRaw;

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "empty_patch", message: "Nenhuma alteracao valida foi enviada." },
      { status: 400 },
    );
  }

  const updated = await prisma.allowedUser.update({
    where: { id: target.id },
    data,
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      active: true,
      supabaseUserId: true,
      createdBy: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await registerAuthAuditEvent({
    actorUserId: auth.user?.id || null,
    actorEmail: auth.user?.email || null,
    actorRole: auth.user?.role || null,
    targetEmail: updated.email,
    eventType: "auth_user_patch",
    outcome: "success",
    ip,
    userAgent: getRequestUserAgent(request),
    requestPath: `/api/auth/users/${target.id}`,
    requestMethod: "PATCH",
    details: {
      changed_fields: Object.keys(data),
      role: updated.role,
      active: updated.active,
    },
  });

  return NextResponse.json({ item: updated });
}
