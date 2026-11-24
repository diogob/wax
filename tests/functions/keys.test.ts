import { after, before, describe, it } from "node:test";
import { expect } from "@std/expect";
import { serviceClient } from "../../supabase/functions/_shared/db.ts";
import {
  readOwnKey,
  revokeOwnKey,
  storeRevocation,
} from "../../supabase/functions/_shared/keys.ts";
import {
  createGpgKey,
  type GpgKey,
  importedValidity,
  killAgent,
  revocationCertificate,
} from "../harness/gpg.ts";
import { publishGpgKey } from "../harness/keys.ts";

let alice: GpgKey;
let bob: GpgKey;
let carol: GpgKey;
let dave: GpgKey;
let erin: GpgKey;

before(async () => {
  [alice, bob, carol, dave, erin] = await Promise.all([
    createGpgKey("Alice"),
    createGpgKey("Bob"),
    createGpgKey("Carol"),
    createGpgKey("Dave"),
    createGpgKey("Erin"),
  ]);
});
after(async () => {
  await Promise.all([alice, bob, carol, dave, erin].map(killAgent));
});

describe("readOwnKey", () => {
  describe("when the key belongs to another user", () => {
    it("fails with bad_request", async () => {
      await publishGpgKey(alice);
      const { userId } = await publishGpgKey(bob);

      const result = readOwnKey(serviceClient(), userId, alice.fingerprint);

      await expect(result).rejects.toMatchObject({ code: "bad_request" });
    });
  });
});

describe("revokeOwnKey", () => {
  describe("when given the key's own revocation certificate", () => {
    it("returns a key gpg imports as revoked", async () => {
      const { ownKey } = await publishGpgKey(carol);
      const certificate = await revocationCertificate(carol);

      const result = await revokeOwnKey(ownKey, certificate);

      expect(await importedValidity(result.armored)).toBe("r");
    });
  });

  describe("when given another key's revocation certificate", () => {
    it("throws instead of merging it", async () => {
      const { ownKey } = await publishGpgKey(dave);
      const certificate = await revocationCertificate(bob);

      const result = revokeOwnKey(ownKey, certificate);

      await expect(result).rejects.toThrow("not a valid revocation certificate");
    });
  });
});

describe("storeRevocation", () => {
  describe("when the key was already revoked", () => {
    it("returns the first revocation", async () => {
      const { userId, ownKey } = await publishGpgKey(erin);
      const first = await revocationCertificate(erin);
      await storeRevocation(serviceClient(), userId, ownKey, first);

      const result = await storeRevocation(serviceClient(), userId, ownKey, "second");

      expect(result).toBe(first);
    });
  });
});
