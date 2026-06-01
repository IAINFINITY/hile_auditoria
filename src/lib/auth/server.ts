import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type AppAuthRole = "superadmin" | "admin";
const BOOTSTRAP_SUPERADMIN_EMAIL = "contato@hile.com.br";

export interface AuthorizedUserContext {
  authorized: boolean;
  role: AppAuthRole | null;
  reason:
    | "missing_identity"
    | "not_allowlisted"
    | "inactive_user"
    | "identity_mismatch"
    | "db_error"
    | null;
  allowedUserId: string | null;
  userId: string | null;
  email: string | null;
}

export interface AuthAuditEventInput {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  targetEmail?: string | null;
  eventType: string;
  outcome: string;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestPath?: string | null;
  requestMethod?: string | null;
  details?: Record<string, unknown> | null;
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeRole(value: unknown): AppAuthRole {
  return String(value || "").trim().toLowerCase() === "superadmin" ? "superadmin" : "admin";
}

export function hasRequiredRole(currentRole: AppAuthRole | null | undefined, requiredRole: AppAuthRole): boolean {
  const rank: Record<AppAuthRole, number> = {
    admin: 10,
    superadmin: 20,
  };
  const current = currentRole ? rank[normalizeRole(currentRole)] : 0;
  const required = rank[normalizeRole(requiredRole)];
  return current >= required;
}

export async function registerAuthAuditEvent(input: AuthAuditEventInput): Promise<void> {
  try {
    await prisma.authAuditEvent.create({
      data: {
        tenantId: input.tenantId || null,
        actorUserId: input.actorUserId || null,
        actorEmail: input.actorEmail || null,
        actorRole: input.actorRole || null,
        targetEmail: input.targetEmail || null,
        eventType: String(input.eventType || "").trim() || "auth_event",
        outcome: String(input.outcome || "").trim() || "unknown",
        reason: input.reason || null,
        ip: input.ip || null,
        userAgent: input.userAgent || null,
        requestPath: input.requestPath || null,
        requestMethod: input.requestMethod || null,
        detailsJson: input.details ? (input.details as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch {
    // Non-blocking by design.
  }
}

export async function ensureBootstrapSuperadmin(): Promise<void> {
  const bootstrapEmail = normalizeEmail(BOOTSTRAP_SUPERADMIN_EMAIL);
  try {
    const total = await prisma.allowedUser.count();
    if (total > 0) return;
    await prisma.allowedUser.create({
      data: {
        email: bootstrapEmail,
        role: "superadmin",
        active: true,
        createdBy: "bootstrap_default",
      },
    });
  } catch {
    // noop
  }
}

export async function getAuthorizedUserContext(
  supabase: unknown,
  userInput?: { id?: string | null; email?: string | null } | null,
): Promise<AuthorizedUserContext> {
  void supabase;
  const userId = String(userInput?.id || "").trim() || null;
  const email = normalizeEmail(userInput?.email);
  const safeEmail = email || null;

  if (!userId || !safeEmail) {
    return {
      authorized: false,
      role: null,
      reason: "missing_identity",
      allowedUserId: null,
      userId,
      email: safeEmail,
    };
  }

  await ensureBootstrapSuperadmin();

  try {
    const row = await prisma.allowedUser.findFirst({
      where: {
        OR: [{ supabaseUserId: userId }, { email: safeEmail }],
      },
    });

    if (!row) {
      return {
        authorized: false,
        role: null,
        reason: "not_allowlisted",
        allowedUserId: null,
        userId,
        email: safeEmail,
      };
    }

    if (!row.active) {
      return {
        authorized: false,
        role: null,
        reason: "inactive_user",
        allowedUserId: row.id,
        userId,
        email: safeEmail,
      };
    }

    if (row.supabaseUserId && row.supabaseUserId !== userId) {
      return {
        authorized: false,
        role: null,
        reason: "identity_mismatch",
        allowedUserId: row.id,
        userId,
        email: safeEmail,
      };
    }

    if (!row.supabaseUserId) {
      await prisma.allowedUser.update({
        where: { id: row.id },
        data: {
          supabaseUserId: userId,
          lastLoginAt: new Date(),
        },
      });
    } else {
      await prisma.allowedUser.update({
        where: { id: row.id },
        data: { lastLoginAt: new Date() },
      });
    }

    return {
      authorized: true,
      role: normalizeRole(row.role),
      reason: null,
      allowedUserId: row.id,
      userId,
      email: safeEmail,
    };
  } catch {
    return {
      authorized: false,
      role: null,
      reason: "db_error",
      allowedUserId: null,
      userId,
      email: safeEmail,
    };
  }
}

export async function getIsAuthorizedUser(
  supabase: unknown,
  userId?: string | null,
  email?: string | null,
): Promise<boolean> {
  const context = await getAuthorizedUserContext(supabase, { id: userId || null, email: email || null });
  return context.authorized;
}
