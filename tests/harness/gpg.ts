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

async function createGpgKey(
  name = "Wax Test",
  { encrypt = true }: { encrypt?: boolean } = {},
): Promise<GpgKey> {
  const home = await Deno.makeTempDir({ dir: "/tmp", prefix: "wax-gpg-" });
  await gpg(home, [
    "--quick-gen-key",
    `${name} <${crypto.randomUUID()}@wax.test>`,
    "ed25519",
    "sign",
    "never",
  ]);
  const colons = await gpg(home, ["--with-colons", "--list-keys"]);
  const fingerprint = colons.split("\n").find((line) => line.startsWith("fpr:"))!.split(":")[9]!;
  if (encrypt) await gpg(home, ["--quick-add-key", fingerprint, "cv25519", "encr", "never"]);
  const publicKey = await gpg(home, ["--armor", "--export", fingerprint]);
  return { home, fingerprint, publicKey };
}

// Same as the command shown to users: printf '%s\n' "<statement>" | gpg --clearsign
function clearsign(key: GpgKey, text: string): Promise<string> {
  return gpg(key.home, ["--clearsign"], `${text}\n`);
}

// Replacing a key, as shown to users: gpg --clearsign -u NEW -u CURRENT, with both secret
// keys in one keyring (`second`'s is imported into `first`'s).
async function clearsignWithBoth(first: GpgKey, second: GpgKey, text: string): Promise<string> {
  await gpg(first.home, ["--import"], await exportSecretKey(second));
  return gpg(
    first.home,
    ["--clearsign", "-u", first.fingerprint, "-u", second.fingerprint],
    `${text}\n`,
  );
}

// `key`'s public key with a certification by `signer` (a third-party signature).
async function certifiedBy(key: GpgKey, signer: GpgKey): Promise<string> {
  await gpg(signer.home, ["--import"], key.publicKey);
  await gpg(signer.home, ["--quick-sign-key", key.fingerprint]);
  return gpg(signer.home, ["--armor", "--export", key.fingerprint]);
}

// Key IDs of everyone who signed the user IDs of an armored key, as gpg sees it after import.
async function certifiers(armored: string): Promise<string[]> {
  const home = await Deno.makeTempDir({ dir: "/tmp", prefix: "wax-gpg-" });
  await gpg(home, ["--import"], armored);
  const colons = await gpg(home, ["--with-colons", "--list-sigs"]);
  return colons.split("\n").filter((line) => line.startsWith("sig:")).map((line) =>
    line.split(":")[4]!
  );
}

// `key`'s public key with `count` more user IDs.
async function withExtraUserIds(key: GpgKey, count: number): Promise<string> {
  for (let index = 0; index < count; index++) {
    await gpg(key.home, [
      "--quick-add-uid",
      key.fingerprint,
      `Extra ${index} <x${index}@wax.test>`,
    ]);
  }
  return gpg(key.home, ["--armor", "--export", key.fingerprint]);
}

// Inner part of a Wax message: gpg --sign --encrypt -r <each recipient> --armor
async function signEncrypt(
  sender: GpgKey,
  recipients: GpgKey[],
  text: string,
): Promise<string> {
  for (const recipient of recipients) {
    if (recipient !== sender) await gpg(sender.home, ["--import"], recipient.publicKey);
  }
  const recipientArgs = recipients.flatMap((recipient) => ["-r", recipient.fingerprint]);
  return (await gpg(sender.home, [
    "--trust-model",
    "always",
    "--sign",
    "--encrypt",
    "--armor",
    ...recipientArgs,
  ], text)).trimEnd();
}

function exportSecretKey(key: GpgKey): Promise<string> {
  return gpg(key.home, ["--armor", "--export-secret-keys", key.fingerprint]);
}

async function killAgent(key: GpgKey): Promise<void> {
  await new Deno.Command("gpgconf", { args: ["--homedir", key.home, "--kill", "gpg-agent"] })
    .output();
}

export {
  certifiedBy,
  certifiers,
  clearsign,
  clearsignWithBoth,
  createGpgKey,
  exportSecretKey,
  killAgent,
  signEncrypt,
  withExtraUserIds,
};
export type { GpgKey };
