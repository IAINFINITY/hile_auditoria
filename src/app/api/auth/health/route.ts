import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const bootstrapEmail = "contato@hile.com.br";
    const total = await prisma.allowedUser.count();
    const active = await prisma.allowedUser.count({ where: { active: true } });
    const superadmins = await prisma.allowedUser.count({ where: { active: true, role: "superadmin" } });
    const admins = await prisma.allowedUser.count({ where: { active: true, role: "admin" } });
    const bootstrapExists = await prisma.allowedUser.count({
      where: { email: bootstrapEmail },
    });

    return NextResponse.json({
      ok: true,
      mode: "allowlist",
      bootstrap_superadmin_email: bootstrapEmail,
      bootstrap_superadmin_exists: bootstrapExists > 0,
      has_supabase_service_role_key: Boolean(String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()),
      users: {
        total,
        active,
        superadmins,
        admins,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao verificar auth health.";
    return NextResponse.json({ ok: false, error: "auth_health_failed", message }, { status: 500 });
  }
}
