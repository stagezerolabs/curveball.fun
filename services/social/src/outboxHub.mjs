const MAX_REPLAY_EVENTS = 1_000;
const MAX_QUEUED_EVENTS = 512;

export function createOutboxHub({
  query,
  subscribe,
  pollMs = 2_000,
  heartbeatMs = 20_000,
  maxClients = 500,
  maxClientsPerIp = 200,
}) {
  const clients = new Set();
  let cursor = 0n;
  let started;
  let polling = false;
  let pollTimer;
  let unsubscribe;

  function closeClient(client, hard = false) {
    if (client.closed) return;
    client.closed = true;
    clearInterval(client.heartbeat);
    clients.delete(client);
    if (hard && typeof client.response.destroy === "function")
      client.response.destroy();
    else client.response.end();
    if (!clients.size) {
      clearInterval(pollTimer);
      pollTimer = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    }
  }

  function write(client, value) {
    if (client.closed) return false;
    // An EventSource client that cannot drain is allowed to reconnect and replay.
    try {
      if (client.response.write(value)) return true;
    } catch {
      // A broken socket must not interrupt delivery to other subscribers.
    }
    closeClient(client, true);
    return false;
  }

  function deliver(client, row) {
    const id = BigInt(row.id);
    if (id <= client.lastSent) return;
    if (client.replaying) {
      client.queue.push(row);
      if (client.queue.length > MAX_QUEUED_EVENTS) closeClient(client, true);
      return;
    }
    if (
      write(
        client,
        `id: ${row.id}\nevent: ${row.topic}\ndata: ${JSON.stringify(row.payload)}\n\n`,
      )
    )
      client.lastSent = id;
  }

  async function pump() {
    if (polling || !clients.size) return;
    polling = true;
    try {
      do {
        const result = await query(
          `SELECT id,topic,payload FROM notification_outbox
          WHERE id>$1 AND available_at<=now() ORDER BY id ASC LIMIT 100`,
          [cursor.toString()],
        );
        for (const row of result.rows) {
          cursor = BigInt(row.id);
          for (const client of clients) deliver(client, row);
        }
        if (result.rows.length < 100) break;
      } while (clients.size);
    } catch {
      for (const client of clients)
        write(client, "event: stream_error\ndata: {}\n\n");
    } finally {
      polling = false;
    }
  }

  async function ensureStarted() {
    if (!started) {
      started = query(
        "SELECT COALESCE(MAX(id),0) AS id FROM notification_outbox",
      )
        .then((result) => {
          cursor = BigInt(result.rows[0].id);
        })
        .catch((error) => {
          started = undefined;
          throw error;
        });
    }
    await started;
  }

  async function open(response, suppliedId, remoteAddress) {
    await ensureStarted();
    if (response.destroyed || response.writableEnded) return;
    // Bounded per connection: each client holds a socket, a heartbeat timer and a replay queue,
    // so an unauthenticated flood must not grow the hub without limit. Rejected clients are asked
    // to retry in a minute instead of reconnecting every three seconds.
    const ip =
      typeof remoteAddress === "string" && remoteAddress
        ? remoteAddress
        : "unknown";
    let ipCount = 0;
    for (const client of clients) {
      if (client.ip === ip) ipCount += 1;
    }
    if (clients.size >= maxClients || ipCount >= maxClientsPerIp) {
      const reason =
        clients.size >= maxClients ? "server_full" : "too_many_connections";
      write(
        { response, closed: false },
        `retry: 60000\nevent: stream_rejected\ndata: ${JSON.stringify({ reason })}\n\n`,
      );
      if (typeof response.destroy === "function") response.destroy();
      else response.end();
      return;
    }
    const watermark = cursor;
    const replayFrom =
      typeof suppliedId === "string" && /^\d+$/.test(suppliedId)
        ? BigInt(suppliedId) > watermark
          ? watermark
          : BigInt(suppliedId)
        : watermark;
    const client = {
      response,
      ip,
      lastSent: replayFrom,
      replaying: true,
      queue: [],
      closed: false,
      heartbeat: null,
    };
    clients.add(client);
    if (!pollTimer) {
      unsubscribe = subscribe?.(() => void pump());
      pollTimer = setInterval(() => void pump(), pollMs);
    }
    response.on("close", () => closeClient(client));
    client.heartbeat = setInterval(
      () => write(client, ": heartbeat\n\n"),
      heartbeatMs,
    );
    write(
      client,
      `event: ready\ndata: ${JSON.stringify({ cursor: replayFrom.toString() })}\n\n`,
    );
    try {
      let replayed = 0;
      while (
        !client.closed &&
        client.lastSent < watermark &&
        replayed < MAX_REPLAY_EVENTS
      ) {
        const result = await query(
          `SELECT id,topic,payload FROM notification_outbox
          WHERE id>$1 AND id<=$2 AND available_at<=now() ORDER BY id ASC LIMIT 100`,
          [client.lastSent.toString(), watermark.toString()],
        );
        if (!result.rows.length) break;
        for (const row of result.rows) {
          client.replaying = false;
          deliver(client, row);
          client.replaying = true;
          replayed += 1;
          if (client.closed) break;
        }
        if (result.rows.length < 100) break;
      }
      if (replayed >= MAX_REPLAY_EVENTS && client.lastSent < watermark) {
        write(
          client,
          'event: stream_error\ndata: {"reason":"replay_limit"}\n\n',
        );
        closeClient(client);
        return;
      }
      client.replaying = false;
      client.queue.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      for (const row of client.queue) deliver(client, row);
      client.queue = [];
    } catch {
      write(client, "event: stream_error\ndata: {}\n\n");
      closeClient(client);
    }
  }

  return {
    open,
    pump,
    get clientCount() {
      return clients.size;
    },
  };
}
