// Real gpg keys for tests: each key lives in its own temporary GNUPGHOME.
// /tmp keeps the agent socket path short (macOS temp dirs are too long for it).

type GpgKey = {
  home: string;
  fingerprint: string;
  publicKey: string; // armored
};

async function gpg(home: string, args: string[], stdin?: string): Promise<string> {
  const cmd = new Deno.Command("gpg", {
    args: [
      "--homedir",
      home,
      "--batch",
      "--pinentry-mode",
      "loopback",
      "--passphrase",
      "",
      ...args,
    ],
    stdin: stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();
  if (stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
  }
  const { code, stdout, stderr } = await child.output();
  if (code !== 0) {
    throw new Error(`gpg ${args.join(" ")} failed:\n${new TextDecoder().decode(stderr)}`);
  }
  return new TextDecoder().decode(stdout);
}

async function createGpgKey(name = "Wax Test"): Promise<GpgKey> {
  const home = await Deno.makeTempDir({ dir: "/tmp", prefix: "wax-gpg-" });
  await gpg(home, [
    "--quick-gen-key",
    `${name} <${crypto.randomUUID()}@wax.test>`,
    "ed25519",
    "sign",
    "never",
  ]);
  const colons = await gpg(home, ["--with-colons", "--list-keys"]);
  const fingerprint = colons.split("\n").find((l) => l.startsWith("fpr:"))!.split(":")[9]!;
  await gpg(home, ["--quick-add-key", fingerprint, "cv25519", "encr", "never"]);
  const publicKey = await gpg(home, ["--armor", "--export", fingerprint]);
  return { home, fingerprint, publicKey };
}

// Same as the command shown to users: printf '%s\n' "<statement>" | gpg --clearsign
function clearsign(key: GpgKey, text: string): Promise<string> {
  return gpg(key.home, ["--clearsign"], `${text}\n`);
}

// Inner part of a Wax message: gpg --sign --encrypt -r <each recipient> --armor
async function signEncrypt(
  sender: GpgKey,
  recipients: GpgKey[],
  text: string,
): Promise<string> {
  for (const r of recipients) {
    if (r !== sender) await gpg(sender.home, ["--import"], r.publicKey);
  }
  const rs = recipients.flatMap((r) => ["-r", r.fingerprint]);
  return (await gpg(sender.home, [
    "--trust-model",
    "always",
    "--sign",
    "--encrypt",
    "--armor",
    ...rs,
  ], text)).trimEnd();
}

async function killAgent(key: GpgKey): Promise<void> {
  await new Deno.Command("gpgconf", { args: ["--homedir", key.home, "--kill", "gpg-agent"] })
    .output();
}

export { clearsign, createGpgKey, killAgent, signEncrypt };
export type { GpgKey };
