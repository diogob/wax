function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not set. Run scripts/local-env.sh with the local stack running.`);
  }
  return value;
}

export const env = {
  get url() {
    return requireEnv("SUPABASE_URL");
  },
  get publishableKey() {
    return requireEnv("SUPABASE_PUBLISHABLE_KEY");
  },
  get serviceKey() {
    return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  },
  get dbUrl() {
    return requireEnv("SUPABASE_DB_URL");
  },
};
