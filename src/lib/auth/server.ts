import "server-only";

export async function getIsAuthorizedUser(supabase: unknown, userId?: string | null): Promise<boolean> {
  void supabase;
  return Boolean(userId);
}
