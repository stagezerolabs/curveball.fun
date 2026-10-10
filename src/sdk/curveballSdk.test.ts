import { expect, test } from "bun:test";
import { validateTokenInput } from "./curveballSdk";

const metadataCid = "bafkreicwtm2hta4j7xpbgk7zer4ca6lyosjihya4dvm4zmgchogxbv3bd4";

test("accepts the CIDv1 metadata URI returned by Pinata", () => {
  expect(validateTokenInput({ name: "Demo", symbol: "DEMO", uri: `ipfs://${metadataCid}` }).uri)
    .toBe(`ipfs://${metadataCid}`);
});

test("rejects malformed IPFS metadata URIs", () => {
  expect(() => validateTokenInput({ name: "Demo", symbol: "DEMO", uri: "ipfs://bad-cid" })).toThrow();
});
