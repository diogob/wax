import { describe, it } from "node:test";
import { expect } from "@std/expect";
import { anonClient, createTestUser } from "../harness/clients.ts";

describe("api.health", () => {
  it("is callable by anon", async () => {
    const { data, error } = await anonClient().rpc("health");
    expect(error).toBeNull();
    expect(data).toBe("ok");
  });

  it("is callable by an authenticated user", async () => {
    const user = await createTestUser();
    const { data, error } = await user.client.rpc("health");
    expect(error).toBeNull();
    expect(data).toBe("ok");
  });
});

describe("schema exposure", () => {
  it("private schema is not reachable over HTTP", async () => {
    const { error } = await anonClient().schema("private" as "api").rpc("health");
    expect(error).not.toBeNull();
  });

  it("service schema is not callable by anon", async () => {
    const { error } = await anonClient().schema("service" as "api").rpc("health");
    expect(error).not.toBeNull();
  });
});
