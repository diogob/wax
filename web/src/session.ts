// The signed-in user: auth session, username, and own profile. Undefined while loading.
import { signal } from "@preact/signals";
import { fromRpc, type Result } from "./call.ts";
import type { Database } from "../../supabase/functions/_shared/db.types.ts";
import type { Api } from "./supabase.ts";

type Profile = Database["api"]["CompositeTypes"]["profile"];
type ProfileKey = Database["api"]["CompositeTypes"]["profile_key"];
type Account = { userId: string; email: string };

const account = signal<Account | null | undefined>(undefined);
// Null until the user claims one.
const username = signal<string | null | undefined>(undefined);
const profile = signal<Profile | undefined>(undefined);

/** Follows the auth session; loads the username and profile on sign-in. */
function startSession(api: Api) {
  api.auth.onAuthStateChange((_event, session) => {
    // Back from a magic link: supabase-js exchanged ?code=…; drop it from the address bar.
    if (session && location.search.includes("code=")) {
      history.replaceState(null, "", location.pathname + location.hash);
    }
    const next = session ? { userId: session.user.id, email: session.user.email ?? "" } : null;
    if (next?.userId === account.peek()?.userId) return;
    account.value = next;
    username.value = next ? undefined : null;
    profile.value = undefined;
    // Not awaited inside the callback: supabase-js deadlocks on calls made from it.
    if (next) setTimeout(() => loadUsername(api));
  });
}

async function loadUsername(api: Api) {
  // The generated type says string; it is null until the user claims a username.
  const result = fromRpc(await api.rpc("my_username"));
  if (result.failure) return console.error(result.failure);
  username.value = result.data ?? null;
  if (result.data) await loadProfile(api);
}

/** Reloads the signed-in user's profile (after publishing or revoking a key). */
async function loadProfile(api: Api) {
  if (!username.peek()) return;
  const result = fromRpc(await api.rpc("profile", { username: username.peek()! }));
  if (result.failure) return console.error(result.failure);
  profile.value = result.data;
}

/** Sends a magic link that brings the user back to this page. */
async function signIn(api: Api, email: string): Promise<Result<null>> {
  const { error } = await api.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (!error) return { data: null };
  if (error.status === 429) {
    return { failure: { code: "bad_request", message: "Too many sign-in emails. Try later." } };
  }
  console.error(error);
  return { failure: { code: error.status ? "internal" : "network", message: error.message } };
}

async function signOut(api: Api) {
  await api.auth.signOut();
  location.hash = "#/";
}

/** The current key: the newest one, unless it is revoked. */
function currentKey(keys: ProfileKey[] | null | undefined): ProfileKey | undefined {
  const newest = keys?.[0];
  return newest && !newest.revoked_at ? newest : undefined;
}

export { account, currentKey, loadProfile, profile, signIn, signOut, startSession, username };
export type { Profile, ProfileKey };
