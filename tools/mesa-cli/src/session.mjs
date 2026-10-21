/**
 * session.mjs - a logged-in, connected session against a live Fusion server.
 *
 * Goes through the normal door only: POST /api/auth/login for a token, then the
 * world socket (`/world/<id>`) with that token, and every change is an `op`
 * envelope handled by the same server pipeline as the browser client's
 * (validation, derivation, persistence, broadcast). Nothing here touches SQLite.
 */
import { io } from "socket.io-client";
import { PROTOCOL_VERSION } from "@fusion/shared";

const OP_TIMEOUT_MS = 10_000;
const SNAPSHOT_TIMEOUT_MS = 10_000;

export class MesaError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "MesaError";
    this.code = code ?? "ERROR";
  }
}

async function http(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new MesaError(`Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`, "UNREACHABLE");
  }
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Pick a user by id or case-insensitive name from the public join list. */
export function pickUser(users, wanted) {
  const w = wanted.toLowerCase();
  const byId = users.find((u) => String(u.id).toLowerCase() === w);
  if (byId) return byId;
  const matches = users.filter((u) => String(u.name).toLowerCase() === w);
  if (matches.length === 1) return matches[0];
  const names = users.map((u) => u.name).join(", ");
  throw new MesaError(
    matches.length > 1 ? `User name "${wanted}" is ambiguous.` : `No user "${wanted}". Users: ${names}`,
    "USER_NOT_FOUND",
  );
}

/**
 * Log in and connect.
 * @param {{url?: string, user?: string, password?: string}} opts
 */
export async function connect(opts = {}) {
  const url = (opts.url ?? "http://127.0.0.1:33000").replace(/\/+$/, "");
  const userName = opts.user ?? "Gamemaster";

  const world = await http(`${url}/api/world`);
  if (world.status !== 200 || !world.body?.world) {
    throw new MesaError(`${url}/api/world answered ${world.status}; is this a Fusion server?`, "NOT_FUSION");
  }
  const worldInfo = world.body.world;
  const joinUser = pickUser(worldInfo.users ?? [], userName);

  const login = await http(`${url}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      userId: joinUser.id,
      ...(opts.password ? { password: opts.password } : {}),
    }),
  });
  if (login.status !== 200 || !login.body?.accessToken) {
    throw new MesaError(
      `Login failed (${login.status}): ${login.body?.message ?? login.body?.code ?? "unknown"}`,
      login.body?.code ?? "LOGIN_FAILED",
    );
  }

  const socket = io(`${url}/world/${worldInfo.id}`, {
    auth: { token: login.body.accessToken, protocolVersion: PROTOCOL_VERSION },
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });

  // Listen BEFORE connecting: the server pushes the join snapshot and the presence roster on connect.
  let snapshot = null;
  let roster = null;
  const waiters = [];
  const notify = () => {
    for (const w of waiters.splice(0)) w();
  };
  socket.on("op", (env) => {
    if (env?.type === "resync:full" && env.payload?.snapshot) {
      snapshot = env.payload.snapshot;
      notify();
    }
  });
  socket.on("ephemeral", (env) => {
    if (env?.type === "presence:online") {
      roster = env.payload?.users ?? [];
      notify();
    }
  });

  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", (e) => reject(new MesaError(`Socket refused: ${e.message}`, "SOCKET_REFUSED")));
    socket.connect();
  });

  const until = (cond, ms) =>
    new Promise((resolve) => {
      if (cond()) return resolve();
      const timer = setTimeout(resolve, ms);
      const check = () => {
        if (cond()) {
          clearTimeout(timer);
          resolve();
        } else waiters.push(check);
      };
      waiters.push(check);
    });

  await until(() => snapshot !== null, SNAPSHOT_TIMEOUT_MS);
  if (snapshot === null) {
    // Fallback: ask for a full snapshot explicitly.
    const ack = await send(socket, "resync:request", { lastSeq: 0 });
    const r = ack.result;
    if (r?.type === "full" && r.payload?.snapshot) snapshot = r.payload.snapshot;
  }
  if (snapshot === null) throw new MesaError("The server did not send a world snapshot.", "NO_SNAPSHOT");
  // The roster arrives right after the snapshot; give it a moment (it is informational only).
  await until(() => roster !== null, 500);

  return {
    url,
    world: worldInfo,
    user: login.body.user,
    snapshot,
    roster,
    docs: (type) => snapshot.documents?.[type] ?? [],
    /** Send an op and resolve with the ack; rejects with MesaError when the server refuses it. */
    op: async (type, payload) => {
      const ack = await send(socket, type, payload);
      if (!ack?.ok) {
        throw new MesaError(`${type} refused: ${ack?.message ?? ack?.code ?? "unknown"}`, ack?.code ?? "REFUSED");
      }
      return ack;
    },
    /** Send a read-only query (compendium:list, compendium:index...) and resolve with the raw ack. */
    query: (type, payload, timeoutMs = OP_TIMEOUT_MS) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new MesaError(`Timeout waiting for ${type}`, "TIMEOUT")), timeoutMs);
        socket.emit("query", { type, payload, ts: Date.now() }, (ack) => {
          clearTimeout(timer);
          resolve(ack);
        });
      }),
    /** Subscribe to broadcast op envelopes (what other clients' changes look like). */
    onOp: (fn) => {
      socket.on("op", fn);
    },
    close: () => {
      socket.disconnect();
    },
  };
}

function send(socket, type, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new MesaError(`Timeout waiting for ${type}`, "TIMEOUT")), OP_TIMEOUT_MS);
    socket.emit("op", { type, ts: Date.now(), payload }, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}
