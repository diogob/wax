// Dev server: rebuilds on change (deno bundle --watch) and serves dist/ on :5173.
// No HMR: reload the page after a rebuild. Files in web/public are copied once at startup.
import { serveDir } from "@std/http/file-server";

const port = 5173;

await Deno.remove("dist", { recursive: true }).catch(() => {});
await Deno.mkdir("dist", { recursive: true });
for await (const entry of Deno.readDir("web/public")) {
  await Deno.copyFile(`web/public/${entry.name}`, `dist/${entry.name}`);
}
try {
  await Deno.copyFile("config/local.json", "dist/config.json");
} catch {
  console.error(
    "config/local.json missing. Run scripts/local-env.sh with the local stack running.",
  );
  Deno.exit(1);
}

new Deno.Command(Deno.execPath(), {
  args: [
    "bundle",
    "--watch",
    "--platform",
    "browser",
    "--sourcemap=linked",
    "--outdir",
    "dist",
    "web/index.html",
    "web/mock.html", // UI mock, dev only: http://127.0.0.1:5173/mock.html
  ],
}).spawn();

Deno.serve(
  { port, hostname: "127.0.0.1" },
  (req) => serveDir(req, { fsRoot: "dist", quiet: true }),
);
