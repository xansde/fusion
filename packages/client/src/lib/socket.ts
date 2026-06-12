/**
 * Fusion WebSocket client — socket.io connection manager.
 *
 * Responsibilities:
 * - Connect to the namespace /world/<worldSlug> with the access token.
 * - Authenticate on handshake via `auth: { token, protocolVersion }`.
 * - Handle PROTOCOL_MISMATCH and AUTH_FAILED disconnections gracefully.
 * - Reconnect automatically (socket.io built-in); re-send auth on reconnect.
 * - Expose reactive connection state (for Svelte stores).
 * - system:ping every 10 s to measure RTT (REQ-NET-046 / task spec).
 *
 * The access token is read lazily at connection time from fusionApi so it is
 * always up-to-date after an automatic refresh.
 *
 * REQ-USR-021: token sent as socket.io `auth` object (not as a query param
 * for the Vite dev-proxy scenario — socket.io auth is passed as the `auth`
 * option on the client and read from `socket.handshake.auth` on the server).
 */

import { io, type Socket } from "socket.io-client";
import { PROTOCOL_VERSION } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "protocol_mismatch"
  | "auth_failed";

export type ConnectionStateListener = (state: ConnectionState, rttMs?: number) => void;

// ---------------------------------------------------------------------------
// SocketManager
// ---------------------------------------------------------------------------

export class SocketManager {
  private _socket: Socket | null = null;
  private _state: ConnectionState = "disconnected";
  private _listeners: Set<ConnectionStateListener> = new Set();
  private _pingInterval: ReturnType<typeof setInterval> | null = null;
  private _rttMs: number | null = null;

  /** Token supplier — injected so the manager doesn't import fusionApi directly. */
  constructor(private readonly getToken: () => string | null) {}

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  get state(): ConnectionState {
    return this._state;
  }

  get rttMs(): number | null {
    return this._rttMs;
  }

  get socket(): Socket | null {
    return this._socket;
  }

  /**
   * Subscribe to connection state changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: ConnectionStateListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Connect to /world/<worldSlug>.
   * Safe to call multiple times — disconnects any existing socket first.
   */
  connect(worldSlug: string): void {
    this.disconnect();

    const token = this.getToken();
    this._setState("connecting");

    // Namespace: /world/<worldSlug>
    // The Vite proxy forwards /socket.io/* → :33000
    const socket = io(`/world/${worldSlug}`, {
      auth: {
        token: token ?? "",
        protocolVersion: PROTOCOL_VERSION,
      },
      // Reconnection with exponential backoff + jitter (REQ-NET-060)
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
      // Heartbeat (REQ-NET-061)
      timeout: 25_000,
      // Prefer WebSocket transport
      transports: ["websocket", "polling"],
    });

    this._socket = socket;
    this._attachHandlers(socket);
  }

  /**
   * Disconnect and clean up.
   */
  disconnect(): void {
    this._stopPing();
    if (this._socket) {
      this._socket.removeAllListeners();
      this._socket.disconnect();
      this._socket = null;
    }
    this._setState("disconnected");
    this._rttMs = null;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private _attachHandlers(socket: Socket): void {
    socket.on("connect", () => {
      this._setState("connected");
      this._startPing(socket);
    });

    socket.on("disconnect", (reason: string) => {
      this._stopPing();
      this._rttMs = null;
      // "io server disconnect" means the server closed — don't auto-reconnect
      if (reason === "io server disconnect") {
        this._setState("disconnected");
      } else {
        this._setState("reconnecting");
      }
    });

    socket.on("connect_error", (err: Error) => {
      this._stopPing();
      const message = err.message;

      // Server closes with a descriptive message on auth/protocol failures
      if (message.includes("AUTH_FAILED") || message.includes("4001")) {
        this._setState("auth_failed");
        socket.disconnect();
      } else if (message.includes("PROTOCOL_MISMATCH") || message.includes("4002")) {
        this._setState("protocol_mismatch");
        socket.disconnect();
      } else {
        // Network issue — let socket.io retry
        this._setState("reconnecting");
      }
    });

    socket.io.on("reconnect_attempt", () => {
      this._setState("reconnecting");
      // Re-send fresh token on every reconnect attempt (REQ-USR-021)
      const freshToken = this.getToken();
      if (freshToken) {
        socket.auth = { token: freshToken, protocolVersion: PROTOCOL_VERSION };
      }
    });

    socket.io.on("reconnect", () => {
      this._setState("connected");
      this._startPing(socket);
    });
  }

  /**
   * system:ping every 10 s; measures RTT for the connection indicator.
   *
   * Emits via the 'op' event with type 'system:ping' so it is routed through
   * the HandlerRegistry and reaches systemPingHandler on the server.
   * Using the 'system' event previously caused the ping to be discarded with
   * VALIDATION_FAILED ("System channel not yet active") and systemPingHandler
   * was effectively dead for this code path.
   */
  private _startPing(socket: Socket): void {
    this._stopPing();
    const doPing = (): void => {
      if (!socket.connected) return;
      const sent = Date.now();
      socket.emit("op", { type: "system:ping", ts: sent, payload: {} }, (ack: unknown) => {
        if (ack !== undefined) {
          this._rttMs = Date.now() - sent;
          this._notify();
        }
      });
    };

    // First ping immediately, then every 10 s
    doPing();
    this._pingInterval = setInterval(doPing, 10_000);
  }

  private _stopPing(): void {
    if (this._pingInterval !== null) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  private _setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this._notify();
  }

  private _notify(): void {
    for (const listener of this._listeners) {
      listener(this._state, this._rttMs ?? undefined);
    }
  }
}
