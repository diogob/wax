import { signal } from "@preact/signals";
import type { Api } from "./supabase.ts";

const health = signal<"checking" | "ok" | "down">("checking");

function App({ api }: { api: Api }) {
  if (health.peek() === "checking") {
    api.rpc("health").then(({ data, error }) => {
      health.value = !error && data === "ok" ? "ok" : "down";
    });
  }

  return (
    <main>
      <h1>Wax</h1>
      <p>Backend: {health}</p>
    </main>
  );
}

export { App };
