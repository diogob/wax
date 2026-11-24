import { after, describe, it } from "node:test";
import { expect } from "@std/expect";
import { createTestUser } from "../harness/clients.ts";
import { as, closeSql, sql, uniqueUsername } from "../harness/db.ts";

after(closeSql);

// The SQL side only stores and compares; any text stands in for the armored key.
const armored =
  "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nAQI=\n-----END PGP PUBLIC KEY BLOCK-----\n";

function uniqueFingerprint(): string {
  return crypto.randomUUID().replaceAll("-", "").toUpperCase().padEnd(40, "0");
}

async function userWithName() {
  const user = await createTestUser();
  const username = uniqueUsername();
  await user.client.rpc("claim_username", { name: username });
  return { id: user.id, username };
}

async function createChallenge(userId: string, fingerprint: string): Promise<string> {
  const [row] = await as(
    { role: "service_role" },
    (tx) => tx`select nonce from service.create_key_challenge(${userId}, ${fingerprint})`,
  );
  return row!.nonce;
}

function publish(
  user: { id: string; username: string },
  nonce: string,
  fingerprint: string,
  replaces: string | null = null,
) {
  return as({ role: "service_role" }, async (tx) => {
    const [row] = await tx`
      select service.publish_key(
        ${user.id}, ${user.username}, ${nonce}, ${fingerprint}, ${armored}, ${replaces}
      ) as fingerprint`;
    return row!.fingerprint as string;
  });
}

async function publishFirstKey(user: { id: string; username: string }): Promise<string> {
  const fingerprint = uniqueFingerprint();
  await publish(user, await createChallenge(user.id, fingerprint), fingerprint);
  return fingerprint;
}

function revoke(user: { id: string }, fingerprint: string, revocation = "revocation") {
  return as({ role: "service_role" }, async (tx) => {
    const [row] = await tx`
      select service.revoke_key(${user.id}, ${fingerprint}, ${revocation}) as revocation`;
    return row!.revocation as string;
  });
}

describe("create_key_challenge", () => {
  describe("when the user has a username", () => {
    it("returns it for the statement's User", async () => {
      const user = await userWithName();

      const result = await as(
        { role: "service_role" },
        (tx) =>
          tx`select username from service.create_key_challenge(${user.id}, ${uniqueFingerprint()})`,
      );

      expect(result[0]?.username).toBe(user.username);
    });
  });

  describe("when the user has no username yet", () => {
    it("fails with bad_request", async () => {
      const user = await createTestUser();

      const result = createChallenge(user.id, uniqueFingerprint());

      await expect(result).rejects.toMatchObject({ code: "WX003" });
    });
  });

  describe("when the key is already published", () => {
    it("fails with conflict", async () => {
      const owner = await userWithName();
      const fingerprint = await publishFirstKey(owner);
      const user = await userWithName();

      const result = createChallenge(user.id, fingerprint);

      await expect(result).rejects.toMatchObject({ code: "WX004" });
    });
  });

  describe("when called by a signed-in user", () => {
    it("is denied", async () => {
      const user = await userWithName();

      const result = as(
        { role: "authenticated", userId: user.id },
        (tx) => tx`select service.create_key_challenge(${user.id}, ${uniqueFingerprint()})`,
      );

      await expect(result).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("publish_key", () => {
  describe("when the challenge matches and the user has no key", () => {
    it("returns the fingerprint", async () => {
      const user = await userWithName();
      const fingerprint = uniqueFingerprint();
      const nonce = await createChallenge(user.id, fingerprint);

      const result = await publish(user, nonce, fingerprint);

      expect(result).toBe(fingerprint);
    });
  });

  describe("when the challenge was already used", () => {
    it("fails with conflict", async () => {
      const user = await userWithName();
      const fingerprint = uniqueFingerprint();
      const nonce = await createChallenge(user.id, fingerprint);
      await publish(user, nonce, fingerprint);

      const result = publish(user, nonce, fingerprint, fingerprint);

      await expect(result).rejects.toMatchObject({ code: "WX004" });
    });
  });

  describe("when the challenge is for another key", () => {
    it("fails with bad_request", async () => {
      const user = await userWithName();
      const nonce = await createChallenge(user.id, uniqueFingerprint());

      const result = publish(user, nonce, uniqueFingerprint());

      await expect(result).rejects.toMatchObject({ code: "WX003" });
    });
  });

  describe("when the challenge belongs to another user", () => {
    it("fails with bad_request", async () => {
      const owner = await userWithName();
      const fingerprint = uniqueFingerprint();
      const nonce = await createChallenge(owner.id, fingerprint);
      const user = await userWithName();

      const result = publish(user, nonce, fingerprint);

      await expect(result).rejects.toMatchObject({ code: "WX003" });
    });
  });

  describe("when the challenge expired", () => {
    it("fails with bad_request", async () => {
      const user = await userWithName();
      const fingerprint = uniqueFingerprint();
      const [row] = await sql()`
        insert into private.key_challenges (user_id, fingerprint, expires_at)
        values (${user.id}, ${fingerprint}, now() - interval '1 second')
        returning nonce`;

      const result = publish(user, row!.nonce, fingerprint);

      await expect(result).rejects.toMatchObject({ code: "WX003" });
    });
  });

  describe("when User is not the user's username", () => {
    it("fails with bad_request", async () => {
      const user = await userWithName();
      const fingerprint = uniqueFingerprint();
      const nonce = await createChallenge(user.id, fingerprint);

      const result = publish({ ...user, username: uniqueUsername() }, nonce, fingerprint);

      await expect(result).rejects.toMatchObject({ code: "WX003" });
    });
  });

  describe("when the user has a key and replaces is omitted", () => {
    it("fails with conflict", async () => {
      const user = await userWithName();
      await publishFirstKey(user);
      const fingerprint = uniqueFingerprint();
      const nonce = await createChallenge(user.id, fingerprint);

      const result = publish(user, nonce, fingerprint);

      await expect(result).rejects.toMatchObject({ code: "WX004" });
    });
  });

  describe("when replaces is the user's current key", () => {
    it("returns the new fingerprint", async () => {
      const user = await userWithName();
      const current = await publishFirstKey(user);
      const fingerprint = uniqueFingerprint();
      const nonce = await createChallenge(user.id, fingerprint);

      const result = await publish(user, nonce, fingerprint, current);

      expect(result).toBe(fingerprint);
    });
  });
});

describe("publish_key after a revocation", () => {
  describe("when the current key was revoked and replaces is omitted", () => {
    it("returns the new fingerprint", async () => {
      const user = await userWithName();
      await revoke(user, await publishFirstKey(user));
      const fingerprint = uniqueFingerprint();
      const nonce = await createChallenge(user.id, fingerprint);

      const result = await publish(user, nonce, fingerprint);

      expect(result).toBe(fingerprint);
    });
  });
});

describe("revoke_key", () => {
  describe("when the key is the user's", () => {
    it("returns the stored revocation", async () => {
      const user = await userWithName();
      const fingerprint = await publishFirstKey(user);

      const result = await revoke(user, fingerprint, "first");

      expect(result).toBe("first");
    });
  });

  describe("when the key was already revoked", () => {
    it("keeps and returns the first revocation", async () => {
      const user = await userWithName();
      const fingerprint = await publishFirstKey(user);
      await revoke(user, fingerprint, "first");

      const result = await revoke(user, fingerprint, "second");

      expect(result).toBe("first");
    });
  });

  describe("when the key is an older, replaced key of the user", () => {
    it("returns the stored revocation", async () => {
      const user = await userWithName();
      const first = await publishFirstKey(user);
      const second = uniqueFingerprint();
      await publish(user, await createChallenge(user.id, second), second, first);

      const result = await revoke(user, first, "old");

      expect(result).toBe("old");
    });
  });

  describe("when the key belongs to another user", () => {
    it("fails with bad_request", async () => {
      const owner = await userWithName();
      const fingerprint = await publishFirstKey(owner);
      const user = await userWithName();

      const result = revoke(user, fingerprint);

      await expect(result).rejects.toMatchObject({ code: "WX003" });
    });
  });
});

describe("own_key", () => {
  describe("when the key is the user's", () => {
    it("returns its fingerprint", async () => {
      const user = await userWithName();
      const fingerprint = await publishFirstKey(user);

      const result = await as(
        { role: "service_role" },
        (tx) => tx`select fingerprint from service.own_key(${user.id}, ${fingerprint})`,
      );

      expect(result[0]?.fingerprint).toBe(fingerprint);
    });
  });

  describe("when the key belongs to another user", () => {
    it("returns no row", async () => {
      const owner = await userWithName();
      const fingerprint = await publishFirstKey(owner);
      const user = await userWithName();

      const result = await as(
        { role: "service_role" },
        (tx) => tx`select * from service.own_key(${user.id}, ${fingerprint})`,
      );

      expect(result.length).toBe(0);
    });
  });
});

describe("current_key", () => {
  describe("when the user replaced a key", () => {
    it("returns the newer key", async () => {
      const user = await userWithName();
      const first = await publishFirstKey(user);
      const second = uniqueFingerprint();
      await publish(user, await createChallenge(user.id, second), second, first);

      const result = await as(
        { role: "service_role" },
        (tx) => tx`select fingerprint from service.current_key(${user.id})`,
      );

      expect(result[0]?.fingerprint).toBe(second);
    });
  });

  describe("when the current key replaced another", () => {
    it("returns the replaced key's armored key", async () => {
      const user = await userWithName();
      const first = await publishFirstKey(user);
      const second = uniqueFingerprint();
      await publish(user, await createChallenge(user.id, second), second, first);

      const result = await as(
        { role: "service_role" },
        (tx) => tx`select replaced_public_key from service.current_key(${user.id})`,
      );

      expect(result[0]?.replaced_public_key).toBe(armored);
    });
  });

  describe("when the key was published with a challenge", () => {
    it("returns that challenge's nonce", async () => {
      const user = await userWithName();
      const fingerprint = uniqueFingerprint();
      const nonce = await createChallenge(user.id, fingerprint);
      await publish(user, nonce, fingerprint);

      const result = await as(
        { role: "service_role" },
        (tx) => tx`select nonce from service.current_key(${user.id})`,
      );

      expect(result[0]?.nonce).toBe(nonce);
    });
  });

  describe("when the user's newest key is revoked", () => {
    it("returns no row (the key it replaced doesn't come back)", async () => {
      const user = await userWithName();
      const first = await publishFirstKey(user);
      const second = uniqueFingerprint();
      await publish(user, await createChallenge(user.id, second), second, first);
      await revoke(user, second);

      const result = await as(
        { role: "service_role" },
        (tx) => tx`select * from service.current_key(${user.id})`,
      );

      expect(result.length).toBe(0);
    });
  });

  describe("when the user has no key", () => {
    it("returns no row", async () => {
      const user = await userWithName();

      const result = await as(
        { role: "service_role" },
        (tx) => tx`select * from service.current_key(${user.id})`,
      );

      expect(result.length).toBe(0);
    });
  });
});
