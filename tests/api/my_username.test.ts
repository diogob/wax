import { describe, it } from "node:test";
import { expect } from "@std/expect";
import { anonClient, createTestUser } from "../harness/clients.ts";
import { userWithName } from "../harness/keys.ts";

describe("my_username", () => {
  describe("when the caller is not signed in", () => {
    it("is denied", async () => {
      const client = anonClient();

      const result = await client.rpc("my_username");

      expect(result.error?.code).toBe("42501");
    });
  });

  describe("when the caller has no username yet", () => {
    it("returns null", async () => {
      const user = await createTestUser();

      const result = await user.client.rpc("my_username");

      expect(result.data).toBeNull();
    });
  });

  describe("when the caller has a username", () => {
    it("returns it", async () => {
      const user = await userWithName();

      const result = await user.client.rpc("my_username");

      expect(result.data).toBe(user.username);
    });
  });
});
