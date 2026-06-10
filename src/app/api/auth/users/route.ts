import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { registerAuthAuditEvent } from "@/lib/auth/server";
import { consumeRateLimit, getRequestIp, getRequestUserAgent, isSameOriginRequest } from "@/lib/auth/security";
import { requireRole } from "@/lib/server/apiUtils";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeRole(value: unknown): "admin" | "superadmin" {
  return String(value || "").trim().toLowerCase() === "superadmin" ? "superadmin" : "admin";
}

function shouldEnforceOriginCheck(): boolean {
  return process.env.AUTH_ENFORCE_ORIGIN_CHECK !== "false";
}

function mapAllowedUserPayload(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""),
    email: String(row.email || ""),
    displayName: (row.display_name as string | null) ?? (row.displayName as string | null) ?? null,
    role: String(row.role || "admin"),
    active: Boolean(row.active),
    supabaseUserId: (row.supabase_user_id as string | null) ?? (row.supabaseUserId as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? (row.createdBy as string | null) ?? null,
    lastLoginAt: (row.last_login_at as string | null) ?? (row.lastLoginAt as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? (row.createdAt as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? (row.updatedAt as string | null) ?? null,
  };
}

export async function GET(request: Request) {
  const auth = await requireRole("superadmin");
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const metaOnly = url.searchParams.get("meta") === "1";

  try {
    if (metaOnly) {
      const aggregate = await prisma.allowedUser.aggregate({
        _count: { id: true },
        _max: { updatedAt: true },
      });
      const count = aggregate._count.id || 0;
      const maxUpdatedAt = aggregate._max.updatedAt ? aggregate._max.updatedAt.toISOString() : "none";
      const revision = `${count}:${maxUpdatedAt}`;
      return NextResponse.json({ revision, count });
    }

    const users = await prisma.allowedUser.findMany({
      orderBy: [{ role: "desc" }, { email: "asc" }],
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

    const count = users.length;
    const maxUpdatedAt = users.reduce<string>((latest, item) => {
      const current = item.updatedAt ? item.updatedAt.toISOString() : "";
      if (!latest) return current;
      return current > latest ? current : latest;
    }, "");
    const revision = `${count}:${maxUpdatedAt || "none"}`;

    return NextResponse.json({
      items: users,
      revision,
      actor: {
        id: auth.user?.id || null,
        email: auth.user?.email || null,
        role: auth.user?.role || null,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao listar usuários.";
    return NextResponse.json({ error: "auth_users_list_failed", message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("superadmin");
  if (auth.response) return auth.response;

  if (shouldEnforceOriginCheck() && !isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "invalid_origin", message: "Origem inválida para esta operação." },
      { status: 403 },
    );
  }

  const ip = getRequestIp(request);
  const rate = consumeRateLimit({
    key: `auth_users_create:${ip}:${auth.user?.id || "anonymous"}`,
    maxAttempts: 12,
    windowMs: 10 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `Muitas tentativas. Tente novamente em ${rate.retryAfterSec}s.`,
      },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const displayName = String(body.displayName || "").trim() || null;
  const requestedRole = normalizeRole(body.role);

  if (!email || !password) {
    return NextResponse.json(
      { error: "invalid_payload", message: "Email e senha são obrigatórios." },
      { status: 400 },
    );
  }

  if (password.length < 8 || password.length > 72) {
    return NextResponse.json(
      { error: "invalid_password", message: "A senha deve ter entre 8 e 72 caracteres." },
      { status: 400 },
    );
  }

  if (requestedRole !== "admin") {
    return NextResponse.json(
      {
        error: "role_not_allowed",
        message: "Somente usuários admin podem ser criados por esta rota.",
      },
      { status: 400 },
    );
  }

  const existing = await prisma.allowedUser.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing?.active) {
    return NextResponse.json(
      { error: "already_exists", message: "Este usuário já está cadastrado e ativo." },
      { status: 409 },
    );
  }

  const supabaseAdmin = createServiceRoleSupabaseClient();
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      name: displayName,
      role: "admin",
    },
  });

  if (created.error || !created.data?.user?.id) {
    await registerAuthAuditEvent({
      actorUserId: auth.user?.id || null,
      actorEmail: auth.user?.email || null,
      actorRole: auth.user?.role || null,
      targetEmail: email,
      eventType: "auth_user_create",
      outcome: "failed",
      reason: created.error?.message || "supabase_create_user_failed",
      ip,
      userAgent: getRequestUserAgent(request),
      requestPath: "/api/auth/users",
      requestMethod: "POST",
    });
    return NextResponse.json(
      {
        error: "supabase_create_user_failed",
        message: created.error?.message || "Não foi possível criar o usuário no Supabase.",
      },
      { status: 400 },
    );
  }

  let saved: {
    id: string;
    email: string;
    displayName: string | null;
    role: string;
    active: boolean;
    supabaseUserId: string | null;
    createdBy: string | null;
    lastLoginAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  } | null = null;

  try {
    const persisted = await prisma.$transaction(async (tx) => {
      const existingByEmail = await tx.allowedUser.findFirst({
        where: {
          email: {
            equals: email,
            mode: "insensitive",
          },
        },
        orderBy: { createdAt: "desc" },
      });

      if (existingByEmail) {
        return tx.allowedUser.update({
          where: { id: existingByEmail.id },
          data: {
            email,
            supabaseUserId: created.data.user.id,
            displayName,
            role: "admin",
            active: true,
            createdBy: auth.user?.id || null,
          },
        });
      }

      return tx.allowedUser.create({
        data: {
          email,
          supabaseUserId: created.data.user.id,
          displayName,
          role: "admin",
          active: true,
          createdBy: auth.user?.id || null,
        },
      });
    });

    saved = {
      id: persisted.id,
      email: persisted.email,
      displayName: persisted.displayName,
      role: String(persisted.role),
      active: persisted.active,
      supabaseUserId: persisted.supabaseUserId,
      createdBy: persisted.createdBy,
      lastLoginAt: persisted.lastLoginAt ? persisted.lastLoginAt.toISOString() : null,
      createdAt: persisted.createdAt ? persisted.createdAt.toISOString() : null,
      updatedAt: persisted.updatedAt ? persisted.updatedAt.toISOString() : null,
    };
  } catch (persistError: unknown) {
    const fallbackId = `au_${randomUUID()}`;
    const { data: existingAllowed } = await supabaseAdmin
      .from("allowed_users")
      .select("id,email")
      .eq("email", email)
      .maybeSingle();

    if (existingAllowed?.id) {
      const { data: updatedAllowed, error: updateAllowedError } = await supabaseAdmin
        .from("allowed_users")
        .update({
          email,
          supabase_user_id: created.data.user.id,
          display_name: displayName,
          role: "admin",
          active: true,
          created_by: auth.user?.id || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingAllowed.id)
        .select("*")
        .single();

      if (updateAllowedError || !updatedAllowed) {
        await supabaseAdmin.auth.admin.deleteUser(created.data.user.id);
        await registerAuthAuditEvent({
          actorUserId: auth.user?.id || null,
          actorEmail: auth.user?.email || null,
          actorRole: auth.user?.role || null,
          targetEmail: email,
          eventType: "auth_user_create",
          outcome: "failed",
          reason: `allowed_users_update_failed:${updateAllowedError?.message || "unknown"}`,
          ip,
          userAgent: getRequestUserAgent(request),
          requestPath: "/api/auth/users",
          requestMethod: "POST",
        });
        return NextResponse.json(
          {
            error: "allowlist_persist_failed",
            message: "Usuário criado no Auth, mas falhou ao registrar na allowlist. Operação revertida.",
          },
          { status: 500 },
        );
      }

      saved = mapAllowedUserPayload(updatedAllowed);
    } else {
      const { data: insertedAllowed, error: insertAllowedError } = await supabaseAdmin
        .from("allowed_users")
        .insert({
          id: fallbackId,
          email,
          supabase_user_id: created.data.user.id,
          display_name: displayName,
          role: "admin",
          active: true,
          created_by: auth.user?.id || null,
        })
        .select("*")
        .single();

      if (insertAllowedError || !insertedAllowed) {
        await supabaseAdmin.auth.admin.deleteUser(created.data.user.id);
        await registerAuthAuditEvent({
          actorUserId: auth.user?.id || null,
          actorEmail: auth.user?.email || null,
          actorRole: auth.user?.role || null,
          targetEmail: email,
          eventType: "auth_user_create",
          outcome: "failed",
          reason: `allowed_users_insert_failed:${insertAllowedError?.message || "unknown"}`,
          ip,
          userAgent: getRequestUserAgent(request),
          requestPath: "/api/auth/users",
          requestMethod: "POST",
          details: {
            prisma_error:
              persistError instanceof Error ? persistError.message : "prisma_persist_failed_unknown",
          },
        });
        return NextResponse.json(
          {
            error: "allowlist_persist_failed",
            message: "Usuário criado no Auth, mas falhou ao registrar na allowlist. Operação revertida.",
          },
          { status: 500 },
        );
      }

      saved = mapAllowedUserPayload(insertedAllowed);
    }
  }

  if (!saved) {
    await supabaseAdmin.auth.admin.deleteUser(created.data.user.id);
    return NextResponse.json(
      {
        error: "allowlist_persist_failed",
        message: "Usuário criado no Auth, mas não foi possível registrar na allowlist.",
      },
      { status: 500 },
    );
  }

  await registerAuthAuditEvent({
    actorUserId: auth.user?.id || null,
    actorEmail: auth.user?.email || null,
    actorRole: auth.user?.role || null,
    targetEmail: email,
    eventType: "auth_user_create",
    outcome: "success",
    ip,
    userAgent: getRequestUserAgent(request),
    requestPath: "/api/auth/users",
    requestMethod: "POST",
    details: {
      allowed_user_id: saved.id,
      role: saved.role,
      active: saved.active,
    },
  });

  return NextResponse.json({
    item: {
      id: saved.id,
      email: saved.email,
      displayName: saved.displayName,
      role: saved.role,
      active: saved.active,
      supabaseUserId: saved.supabaseUserId,
      createdBy: saved.createdBy,
      lastLoginAt: saved.lastLoginAt,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    },
  });
}
