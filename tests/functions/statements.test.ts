import { after, before, describe, it } from "node:test";
import { expect } from "@std/expect";
import {
  buildGithubProof,
  buildKeyChallenge,
  buildMessage,
  parseGithubProof,
  parseKeyChallenge,
  parseMessage,
} from "../../supabase/functions/_shared/statements.ts";
import { readPublicKey, verifyClearsigned } from "../../supabase/functions/_shared/pgp.ts";
import { clearsign, createGpgKey, type GpgKey, killAgent, signEncrypt } from "../harness/gpg.ts";

const origin = "http://127.0.0.1:5173";
let alice: GpgKey;
let bob: GpgKey;

before(async () => {
  [alice, bob] = await Promise.all([createGpgKey("Alice"), createGpgKey("Bob")]);
});
after(async () => {
  await Promise.all([killAgent(alice), killAgent(bob)]);
});

function challenge(fingerprint: string) {
  return {
    origin,
    user: "alice",
    fingerprint,
    nonce: crypto.randomUUID(),
    expires: "2026-11-23T15:14:05Z",
  };
}

describe("key challenge", () => {
  it("round-trips through gpg --clearsign", async () => {
    const c = challenge(alice.fingerprint);
    const signed = await clearsign(alice, buildKeyChallenge(c));
    const text = await verifyClearsigned(signed, await readPublicKey(alice.publicKey));
    expect(parseKeyChallenge(text)).toEqual(c);
  });

  it("is rejected when signed by another key", async () => {
    const signed = await clearsign(bob, buildKeyChallenge(challenge(alice.fingerprint)));
    await expect(verifyClearsigned(signed, await readPublicKey(alice.publicKey))).rejects.toThrow(
      "signature is not valid",
    );
  });

  it("is rejected when the signed text was edited", async () => {
    const signed = await clearsign(alice, buildKeyChallenge(challenge(alice.fingerprint)));
    const tampered = signed.replace("User: alice", "User: mallory");
    await expect(verifyClearsigned(tampered, await readPublicKey(alice.publicKey))).rejects.toThrow(
      "signature is not valid",
    );
  });

  it("ignores text outside the signed block", async () => {
    const c = challenge(alice.fingerprint);
    const signed = await clearsign(alice, buildKeyChallenge(c));
    const text = await verifyClearsigned(
      `User: mallory\n${signed}\nUser: mallory\n`,
      await readPublicKey(alice.publicKey),
    );
    expect(parseKeyChallenge(text)).toEqual(c);
  });

  it("rejects non-canonical text", () => {
    const text = buildKeyChallenge(challenge(alice.fingerprint));
    expect(() => parseKeyChallenge(text.replace("User: ", "User:  "))).toThrow();
    expect(() => parseKeyChallenge(`${text}\nExtra: 1`)).toThrow("exactly 5 fields");
    expect(() => parseKeyChallenge(text.replace("v1", "v2"))).toThrow("expected");
    expect(() =>
      parseKeyChallenge(text.replace(alice.fingerprint, alice.fingerprint.toLowerCase()))
    ).toThrow(
      "invalid Fingerprint",
    );
  });

  it("refuses to build invalid fields", () => {
    expect(() => buildKeyChallenge({ ...challenge(alice.fingerprint), user: "Alice\nUser: x" }))
      .toThrow(
        "invalid User",
      );
  });

  it("rejects a private key paste", async () => {
    const secret = await new Deno.Command("gpg", {
      args: [
        "--homedir",
        alice.home,
        "--batch",
        "--pinentry-mode",
        "loopback",
        "--passphrase",
        "",
        "--armor",
        "--export-secret-keys",
      ],
      stdout: "piped",
    }).output();
    await expect(readPublicKey(new TextDecoder().decode(secret.stdout))).rejects.toThrow(
      "not a private key",
    );
  });
});

describe("github proof", () => {
  it("round-trips through gpg --clearsign", async () => {
    const p = {
      origin,
      user: "alice",
      github: "Alice-GH",
      fingerprint: alice.fingerprint,
      created: "2026-11-23T15:04:05Z",
    };
    const signed = await clearsign(alice, buildGithubProof(p));
    const text = await verifyClearsigned(signed, await readPublicKey(alice.publicKey));
    expect(parseGithubProof(text)).toEqual(p);
  });
});

describe("message envelope", () => {
  it("round-trips an encrypted body through gpg --clearsign", async () => {
    const body = await signEncrypt(alice, [bob, alice], "hello bob\n");
    const m = {
      origin,
      from: "alice",
      to: "bob",
      id: crypto.randomUUID(),
      sent: "2026-11-23T15:04:05Z",
      body,
    };
    const signed = await clearsign(alice, buildMessage(m));
    expect(signed).toContain("- -----BEGIN PGP MESSAGE-----"); // dash-escaped by gpg
    const text = await verifyClearsigned(signed, await readPublicKey(alice.publicKey));
    expect(parseMessage(text)).toEqual(m);
  });

  it("rejects a body with more than one armored block", async () => {
    const body = await signEncrypt(alice, [bob], "x");
    const m = {
      origin,
      from: "alice",
      to: "bob",
      id: crypto.randomUUID(),
      sent: "2026-11-23T15:04:05Z",
      body,
    };
    expect(() => parseMessage(`${buildMessage(m)}\n${body}`)).toThrow("one armored PGP MESSAGE");
  });
});
