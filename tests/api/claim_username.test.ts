import { describe, it } from "node:test";
import { expect } from "@std/expect";
import { anonClient, createTestUser } from "../harness/clients.ts";
import { uniqueUsername } from "../harness/db.ts";

describe("claim_username", () => {
  describe("when the name is valid and free", () => {
    it("returns the name", async () => {
      const user = await createTestUser();
      const name = uniqueUsername();

      const result = await user.client.rpc("claim_username", { name });

      expect(result.data).toBe(name);
    });
  });

  describe("when the caller is not signed in", () => {
    it("is denied", async () => {
      const name = uniqueUsername();

      const result = await anonClient().rpc("claim_username", { name });

      expect(result.error?.code).toBe("42501");
    });
  });

  describe("when the name has uppercase letters", () => {
    it("fails with bad_request", async () => {
      const user = await createTestUser();
      const name = `U${uniqueUsername()}`;

      const result = await user.client.rpc("claim_username", { name });

      expect(result.error?.code).toBe("WX003");
    });
  });

  describe("when the name is one character", () => {
    it("fails with bad_request", async () => {
      const user = await createTestUser();

      const result = await user.client.rpc("claim_username", { name: "a" });

      expect(result.error?.code).toBe("WX003");
    });
  });

  describe("when the name is taken", () => {
    it("fails with conflict", async () => {
      const owner = await createTestUser();
      const name = uniqueUsername();
      await owner.client.rpc("claim_username", { name });
      const user = await createTestUser();

      const result = await user.client.rpc("claim_username", { name });

      expect(result.error?.code).toBe("WX004");
    });
  });

  describe("when the caller already has a username", () => {
    it("fails with conflict", async () => {
      const user = await createTestUser();
      await user.client.rpc("claim_username", { name: uniqueUsername() });

      const result = await user.client.rpc("claim_username", { name: uniqueUsername() });

      expect(result.error?.code).toBe("WX004");
    });
  });
});
