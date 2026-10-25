import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createOutboxHub } from "./outboxHub.mjs";

class FakeResponse extends EventEmitter {
  chunks = [];
  ended = false;
  write(chunk) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
  }
}

test("one shared pump fans out events and reconnect replay does not duplicate live events", async () => {
  const rows = [
    { id: "1", topic: "trade", payload: { id: "one" } },
    { id: "2", topic: "trade", payload: { id: "two" } },
  ];
  let liveQueries = 0;
  const query = async (sql, params = []) => {
    if (sql.includes("MAX(id)")) return { rows: [{ id: rows.at(-1).id }] };
    if (!sql.includes("id<=")) liveQueries += 1;
    const start = BigInt(params[0]);
    const end = params[1] ? BigInt(params[1]) : null;
    return {
      rows: rows.filter(
        (row) =>
          BigInt(row.id) > start && (end === null || BigInt(row.id) <= end),
      ),
    };
  };
  const hub = createOutboxHub({
    query,
    pollMs: 1_000_000,
    heartbeatMs: 1_000_000,
  });
  const first = new FakeResponse();
  const second = new FakeResponse();
  await hub.open(first, "1");
  await hub.open(second, "2");
  assert.match(first.chunks.join(""), /id: 2\nevent: trade/);
  assert.doesNotMatch(second.chunks.join(""), /id: 2\nevent: trade/);
  rows.push({ id: "3", topic: "reorg", payload: { id: "three" } });
  await hub.pump();
  assert.equal(liveQueries, 1);
  assert.equal(
    (first.chunks.join("").match(/id: 3\nevent: reorg/g) || []).length,
    1,
  );
  assert.equal(
    (second.chunks.join("").match(/id: 3\nevent: reorg/g) || []).length,
    1,
  );
  first.emit("close");
  second.emit("close");
  assert.equal(hub.clientCount, 0);
});

test("a backpressured client is disconnected so it cannot accumulate events", async () => {
  const rows = [{ id: "1", topic: "trade", payload: {} }];
  const query = async (sql, params = []) =>
    sql.includes("MAX(id)")
      ? { rows: [{ id: "1" }] }
      : { rows: rows.filter((row) => BigInt(row.id) > BigInt(params[0])) };
  const hub = createOutboxHub({
    query,
    pollMs: 1_000_000,
    heartbeatMs: 1_000_000,
  });
  const response = new FakeResponse();
  await hub.open(response);
  response.write = () => false;
  rows.push({ id: "2", topic: "trade", payload: {} });
  await hub.pump();
  assert.equal(response.ended, true);
  assert.equal(hub.clientCount, 0);
});
