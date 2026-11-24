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
import { verifyClearsigned } from "../../supabase/functions/_shared/pgp.ts";
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

function challenge() {
  return {
    origin,
    user: "alice",
    fingerprint: alice.fingerprint,
    nonce: crypto.randomUUID(),
    expires: "2026-11-23T15:14:05Z",
  };
}

async function message() {
  return {
    origin,
    from: "alice",
    to: "bob",
    id: crypto.randomUUID(),
    sent: "2026-11-23T15:04:05Z",
    body: await signEncrypt(alice, [bob, alice], "hello bob\n"),
  };
}

// Signs with gpg and returns the text openpgp.js verified, as an Edge Function would see it.
async function signAndVerify(text: string): Promise<string> {
  const signed = await clearsign(alice, text);
  return verifyClearsigned(signed, [alice.publicKey]);
}

describe("buildKeyChallenge", () => {
  describe("when a field contains a newline", () => {
    it("throws instead of letting it inject another field", () => {
      const fields = { ...challenge(), user: "Alice\nUser: x" };

      const result = () => buildKeyChallenge(fields);

      expect(result).toThrow("invalid User");
    });
  });
});

describe("parseKeyChallenge", () => {
  describe("when given a challenge signed with gpg --clearsign", () => {
    it("returns the fields the challenge was built from", async () => {
      const fields = challenge();
      const text = await signAndVerify(buildKeyChallenge(fields));

      const result = parseKeyChallenge(text);

      expect(result).toEqual(fields);
    });
  });

  describe("when a separator has extra whitespace", () => {
    it("throws", () => {
      const text = buildKeyChallenge(challenge()).replace("User: ", "User:  ");

      const result = () => parseKeyChallenge(text);

      expect(result).toThrow();
    });
  });

  describe("when there is an extra field", () => {
    it("throws a field count error", () => {
      const text = `${buildKeyChallenge(challenge())}\nExtra: 1`;

      const result = () => parseKeyChallenge(text);

      expect(result).toThrow("exactly 5 fields");
    });
  });

  describe("when the title has another version", () => {
    it("throws a title error", () => {
      const text = buildKeyChallenge(challenge()).replace("v1", "v2");

      const result = () => parseKeyChallenge(text);

      expect(result).toThrow("expected");
    });
  });

  describe("when the fingerprint is lowercase", () => {
    it("throws an invalid Fingerprint error", () => {
      const text = buildKeyChallenge(challenge())
        .replace(alice.fingerprint, alice.fingerprint.toLowerCase());

      const result = () => parseKeyChallenge(text);

      expect(result).toThrow("invalid Fingerprint");
    });
  });
});

describe("parseGithubProof", () => {
  describe("when given a proof signed with gpg --clearsign", () => {
    it("returns the fields the proof was built from", async () => {
      const fields = {
        origin,
        user: "alice",
        github: "Alice-GH",
        fingerprint: alice.fingerprint,
        created: "2026-11-23T15:04:05Z",
      };
      const text = await signAndVerify(buildGithubProof(fields));

      const result = parseGithubProof(text);

      expect(result).toEqual(fields);
    });
  });
});

describe("parseMessage", () => {
  describe("when given an envelope with an encrypted body, signed with gpg --clearsign", () => {
    it("returns the fields and the body unchanged", async () => {
      const fields = await message();
      const text = await signAndVerify(buildMessage(fields));

      const result = parseMessage(text);

      expect(result).toEqual(fields);
    });
  });

  describe("when the body has a second armored block appended", () => {
    it("throws a body error", async () => {
      const fields = await message();
      const text = `${buildMessage(fields)}\n${fields.body}`;

      const result = () => parseMessage(text);

      expect(result).toThrow("one armored PGP MESSAGE");
    });
  });
});
