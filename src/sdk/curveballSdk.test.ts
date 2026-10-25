import { expect, test } from "bun:test";
import { validateTokenInput } from "./curveballSdk";

test("accepts CIDv1 metadata URIs returned by Pinata Files", () => {
  const uri = `ipfs://bafk${"a".repeat(55)}`;
  expect(validateTokenInput({ name: "Demo", symbol: "DEMO", uri }).uri).toBe(
    uri,
  );
});
