import { after, before, describe, it } from "node:test";
import { expect } from "@std/expect";
import {
  readKeyToPublish,
  revokeKey,
  verifyClearsigned,
} from "../../supabase/functions/_shared/pgp.ts";
import {
  certifiedBy,
  certifiers,
  clearsign,
  clearsignWithBoth,
  createGpgKey,
  exportSecretKey,
  type GpgKey,
  killAgent,
  withExtraUserIds,
} from "../harness/gpg.ts";

let alice: GpgKey;
let bob: GpgKey;
let carol: GpgKey;
let dave: GpgKey;
let signOnly: GpgKey;

before(async () => {
  [alice, bob, carol, dave, signOnly] = await Promise.all([
    createGpgKey("Alice"),
    createGpgKey("Bob"),
    createGpgKey("Carol"),
    createGpgKey("Dave"),
    createGpgKey("Sign Only", { encrypt: false }),
  ]);
});
after(async () => {
  await Promise.all([alice, bob, carol, dave, signOnly].map(killAgent));
});

const text = "Wax test v1\nUser: alice";

describe("verifyClearsigned", () => {
  describe("when signed by another key", () => {
    it("throws a signature error", async () => {
      const signed = await clearsign(bob, text);

      const result = verifyClearsigned(signed, [alice.publicKey]);

      await expect(result).rejects.toThrow("signature is not valid");
    });
  });

  describe("when the signed text was edited", () => {
    it("throws a signature error", async () => {
      const signed = (await clearsign(alice, text)).replace("User: alice", "User: mallory");

      const result = verifyClearsigned(signed, [alice.publicKey]);

      await expect(result).rejects.toThrow("signature is not valid");
    });
  });

  describe("when text was added outside the signed block", () => {
    it("returns only the signed text", async () => {
      const pasted = `User: mallory\n${await clearsign(alice, text)}\nUser: mallory\n`;

      const result = await verifyClearsigned(pasted, [alice.publicKey]);

      expect(result).toBe(`${text}\n`);
    });
  });

  describe("when signed lines start with a dash (gpg dash-escapes them)", () => {
    it("returns them unescaped", async () => {
      const armored = "-----BEGIN PGP MESSAGE-----\n\nabc\n-----END PGP MESSAGE-----";
      const signed = await clearsign(alice, armored);

      const result = await verifyClearsigned(signed, [alice.publicKey]);

      expect(result).toBe(`${armored}\n`);
    });
  });
});

describe("readKeyToPublish", () => {
  describe("when given a private key", () => {
    it("throws instead of accepting it", async () => {
      const secretKey = await exportSecretKey(alice);

      const result = readKeyToPublish(secretKey);

      await expect(result).rejects.toThrow("not a private key");
    });
  });

  describe("when the key is certified by another key", () => {
    it("drops the third-party signature", async () => {
      const certified = await certifiedBy(carol, bob);

      const result = await readKeyToPublish(certified);

      expect(await certifiers(result.armored)).not.toContain(bob.fingerprint.slice(-16));
    });
  });

  describe("when the key has 11 user IDs", () => {
    it("throws a limit error", async () => {
      const armored = await withExtraUserIds(dave, 10);

      const result = readKeyToPublish(armored);

      await expect(result).rejects.toThrow("more than 10 user IDs");
    });
  });

  describe("when the armored key is over 64 KB", () => {
    it("throws a size error", async () => {
      const padding = `Comment: ${"x".repeat(64 * 1024)}\n`;
      const armored = alice.publicKey.replace("-----\n", `-----\n${padding}`);

      const result = readKeyToPublish(armored);

      await expect(result).rejects.toThrow("larger than 64 KB");
    });
  });

  describe("when the key has no encryption subkey", () => {
    it("throws instead of accepting it", async () => {
      const result = readKeyToPublish(signOnly.publicKey);

      await expect(result).rejects.toThrow("no usable encryption subkey");
    });
  });
});

describe("verifyClearsigned with two keys", () => {
  describe("when signed by both keys (gpg -u NEW -u CURRENT)", () => {
    it("returns the signed text", async () => {
      const signed = await clearsignWithBoth(alice, bob, text);
      const keys = [alice.publicKey, bob.publicKey];

      const result = await verifyClearsigned(signed, keys);

      expect(result).toBe(`${text}\n`);
    });
  });

  describe("when signed by the new key only", () => {
    it("throws a signature count error", async () => {
      const signed = await clearsign(alice, text);
      const keys = [alice.publicKey, bob.publicKey];

      const result = verifyClearsigned(signed, keys);

      await expect(result).rejects.toThrow("expected 2 signatures");
    });
  });

  describe("when signed by the new key and an unrelated key", () => {
    it("throws naming the missing key", async () => {
      const signed = await clearsignWithBoth(alice, carol, text);
      const keys = [alice.publicKey, bob.publicKey];

      const result = verifyClearsigned(signed, keys);

      await expect(result).rejects.toThrow(bob.fingerprint);
    });
  });
});

describe("revokeKey", () => {
  describe("when given a signed text instead of a certificate", () => {
    it("throws instead of merging it", async () => {
      const signed = await clearsign(alice, text);

      const result = revokeKey(alice.publicKey, signed);

      await expect(result).rejects.toThrow("not a valid revocation certificate");
    });
  });
});
