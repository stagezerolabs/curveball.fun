import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_WALLET_HEADER, createPrivyAuthenticator } from "./privyAuth.mjs";

const wallet = "0x0000000000000000000000000000000000000001";

function request(headers = {}) {
  return { headers };
}

function client({ verify = async () => ({ user_id: "did:privy:user" }), linkedAccounts = [] } = {}) {
  let userReads = 0;
  return {
    client: {
      utils: () => ({ auth: () => ({ verifyAccessToken: verify }) }),
      users: () => ({
        _get: async () => {
          userReads += 1;
          return { linked_accounts: linkedAccounts };
        },
      }),
    },
    userReads: () => userReads,
  };
}

test("returns null when a request has no Privy access token", async () => {
  const fake = client();
  const authenticate = createPrivyAuthenticator({ client: fake.client });
  assert.equal(await authenticate(request()), null);
});

test("binds a verified Privy user to their requested linked Ethereum wallet", async () => {
  const fake = client({
    linkedAccounts: [{ type: "wallet", chain_type: "ethereum", address: wallet, wallet_client_type: "privy" }],
  });
  const authenticate = createPrivyAuthenticator({ client: fake.client });
  const headers = { authorization: "Bearer valid-token", [ACTIVE_WALLET_HEADER]: wallet };

  const first = await authenticate(request(headers));
  const second = await authenticate(request(headers));

  assert.equal(first.address, wallet);
  assert.equal(first.userId, "did:privy:user");
  assert.equal(second.address, wallet);
  assert.equal(fake.userReads(), 1);
});

test("rejects a wallet address that is not linked to the Privy user", async () => {
  const fake = client({
    linkedAccounts: [{ type: "wallet", chain_type: "ethereum", address: "0x0000000000000000000000000000000000000002" }],
  });
  const authenticate = createPrivyAuthenticator({ client: fake.client });

  await assert.rejects(
    authenticate(request({ authorization: "Bearer valid-token", [ACTIVE_WALLET_HEADER]: wallet })),
    (error) => error.status === 403 && /not linked/i.test(error.message),
  );
});

test("turns token verification failures into an authentication error", async () => {
  const fake = client({ verify: async () => { throw new Error("bad token"); } });
  const authenticate = createPrivyAuthenticator({ client: fake.client });

  await assert.rejects(
    authenticate(request({ authorization: "Bearer expired", [ACTIVE_WALLET_HEADER]: wallet })),
    (error) => error.status === 401 && /expired/i.test(error.message),
  );
});

test("bounds the linked-user cache", async () => {
  let userReads = 0;
  const fake = {
    utils: () => ({
      auth: () => ({ verifyAccessToken: async (token) => ({ user_id: `did:privy:${token}` }) }),
    }),
    users: () => ({
      _get: async () => {
        userReads += 1;
        return {
          linked_accounts: [{ type: "wallet", chain_type: "ethereum", address: wallet }],
        };
      },
    }),
  };
  const authenticate = createPrivyAuthenticator({ client: fake, cacheMaxEntries: 1 });
  const headers = (token) => ({ authorization: `Bearer ${token}`, [ACTIVE_WALLET_HEADER]: wallet });

  await authenticate(request(headers("user-one")));
  await authenticate(request(headers("user-two")));
  await authenticate(request(headers("user-one")));

  assert.equal(userReads, 3);
});
