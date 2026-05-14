import "server-only";

type RpcClient = {
  rpc: (fn: "is_admin_user") => {
    single: () => PromiseLike<{ data: boolean | null; error: { message?: string } | null }>;
  };
};

export async function getIsAuthorizedUser(supabase: RpcClient, userId?: string | null): Promise<boolean> {
  if (!userId) return false;

  const { data, error } = await supabase.rpc("is_admin_user").single();
  if (error) {
    console.error("Failed to resolve authorization status:", error.message ?? error);
    return false;
  }
  return data === true;
}

