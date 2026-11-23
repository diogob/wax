import { after, before, describe, it } from "node:test";
import { expect } from "@std/expect";
import { readPublicKey, verifyClearsigned } from "../../supabase/functions/_shared/pgp.ts";
import {
  clearsign,
  createGpgKey,
  exportSecretKey,
  type GpgKey,
  killAgent,
} from "../harness/gpg.ts";

let alice: GpgKey;
let bob: GpgKey;

before(async () => {
  [alice, bob] = await Promise.all([createGpgKey("Alice"), createGpgKey("Bob")]);
});
after(async () => {
  await Promise.all([killAgent(alice), killAgent(bob)]);
});

const text = "Wax test v1\nUser: alice";

describe("readPublicKey", () => {
  describe("when given a private key", () => {
    it("throws instead of accepting it", async () => {
      const secretKey = await exportSecretKey(alice);

      const result = readPublicKey(secretKey);

      await expect(result).rejects.toThrow("not a private key");
    });
  });
});

describe("verifyClearsigned", () => {
  describe("when signed by another key", () => {
    it("throws a signature error", async () => {
      const signed = await clearsign(bob, text);
      const key = await readPublicKey(alice.publicKey);

      const result = verifyClearsigned(signed, key);

      await expect(result).rejects.toThrow("signature is not valid");
    });
  });

  describe("when the signed text was edited", () => {
    it("throws a signature error", async () => {
      const signed = (await clearsign(alice, text)).replace("User: alice", "User: mallory");
      const key = await readPublicKey(alice.publicKey);

      const result = verifyClearsigned(signed, key);

      await expect(result).rejects.toThrow("signature is not valid");
    });
  });

  describe("when text was added outside the signed block", () => {
    it("returns only the signed text", async () => {
      const pasted = `User: mallory\n${await clearsign(alice, text)}\nUser: mallory\n`;
      const key = await readPublicKey(alice.publicKey);

      const result = await verifyClearsigned(pasted, key);

      expect(result).toBe(`${text}\n`);
    });
  });

  describe("when signed lines start with a dash (gpg dash-escapes them)", () => {
    it("returns them unescaped", async () => {
      const armored = "-----BEGIN PGP MESSAGE-----\n\nabc\n-----END PGP MESSAGE-----";
      const signed = await clearsign(alice, armored);
      const key = await readPublicKey(alice.publicKey);

      const result = await verifyClearsigned(signed, key);

      expect(result).toBe(`${armored}\n`);
    });
  });
});
