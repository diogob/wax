import { after, describe, it } from "node:test";
import { expect } from "@std/expect";
import { anonClient } from "../harness/clients.ts";
import { closeSql, uniqueUsername } from "../harness/db.ts";
import {
  createChallenge,
  publish,
  publishFirstKey,
  revoke,
  uniqueFingerprint,
  userWithName,
} from "../harness/keys.ts";

after(closeSql);

describe("profile", () => {
  describe("when no one has the username", () => {
    it("returns an empty profile", async () => {
      const username = uniqueUsername();

      const result = await anonClient().rpc("profile", { username });

      expect(result.data).toEqual({ username: null, keys: null });
    });
  });

  describe("when the user has no key", () => {
    it("returns no keys", async () => {
      const user = await userWithName();

      const result = await anonClient().rpc("profile", { username: user.username });

      expect(result.data).toEqual({ username: user.username, keys: [] });
    });
  });

  describe("when the user has published a key", () => {
    it("returns it, neither replaced nor revoked", async () => {
      const user = await userWithName();
      const fingerprint = await publishFirstKey(user);

      const result = await anonClient().rpc("profile", { username: user.username });

      expect(result.data?.keys).toEqual([
        expect.objectContaining({ fingerprint, replaced_by: null, revoked_at: null }),
      ]);
    });
  });

  describe("when the user has replaced a key", () => {
    it("returns both, newest first, the old one replaced by the new one", async () => {
      const user = await userWithName();
      const first = await publishFirstKey(user);
      const second = uniqueFingerprint();
      await publish(user, await createChallenge(user.id, second), second, first);

      const result = await anonClient().rpc("profile", { username: user.username });

      expect(result.data?.keys).toEqual([
        expect.objectContaining({ fingerprint: second, replaced_by: null }),
        expect.objectContaining({ fingerprint: first, replaced_by: second }),
      ]);
    });
  });

  describe("when the user has revoked their current key", () => {
    it("returns it with a revocation time", async () => {
      const user = await userWithName();
      const fingerprint = await publishFirstKey(user);
      await revoke(user, fingerprint);

      const result = await anonClient().rpc("profile", { username: user.username });

      expect(result.data?.keys?.[0]?.revoked_at).toEqual(expect.any(String));
    });
  });

  describe("when the user has revoked a replaced key", () => {
    it("returns it replaced and revoked, and the current key not revoked", async () => {
      const user = await userWithName();
      const first = await publishFirstKey(user);
      const second = uniqueFingerprint();
      await publish(user, await createChallenge(user.id, second), second, first);
      await revoke(user, first);

      const result = await anonClient().rpc("profile", { username: user.username });

      expect(result.data?.keys).toEqual([
        expect.objectContaining({ fingerprint: second, revoked_at: null }),
        expect.objectContaining({
          fingerprint: first,
          replaced_by: second,
          revoked_at: expect.any(String),
        }),
      ]);
    });
  });
});
