import { expect, test } from "bun:test";
import { clientAddress } from "../../../src/api/transport/clientAddress.mjs";

const request = (forwarded) => ({
  headers: { "x-curveball-client-ip": forwarded },
  socket: { remoteAddress: "172.20.0.3" },
});

test("uses the socket address unless trusted proxy mode is explicit", () => {
  expect(clientAddress(request("203.0.113.8"))).toBe("172.20.0.3");
  expect(clientAddress(request("203.0.113.8"), true)).toBe("203.0.113.8");
});

test("rejects malformed forwarded addresses", () => {
  expect(clientAddress(request("203.0.113.8, 10.0.0.1"), true)).toBe(
    "172.20.0.3",
  );
  expect(clientAddress(request("attacker.example"), true)).toBe("172.20.0.3");
});
