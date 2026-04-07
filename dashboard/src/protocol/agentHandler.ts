import type { WebSocket } from "ws";
import type { FastifyBaseLogger } from "fastify";
import { validateAgentCredential } from "../enrollment/tokens.js";
import { db } from "../db/connection.js";
import { agents, auditLog } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type {
  AgentMessage,
  DashboardMessage,
  AuthMessage,
  HeartbeatMessage,
  StateSnapshotMessage,
  OperationLogMessage,
  OperationResultMessage,
} from "./messages.js";
import { PROTOCOL_VERSION } from "./messages.js";

interface AgentConnection {
  socket: WebSocket;
  agentId: string;
  hostname: string;
  authenticated: boolean;
  sourceIp: string;
}

/** Manages all active agent WebSocket connections. */
const connections = new Map<string, AgentConnection>();

/** Browser WebSocket connections for forwarding operation logs. */
const browserSockets = new Set<WebSocket>();

export function getConnectedAgents(): Map<string, AgentConnection> {
  return connections;
}

export function addBrowserSocket(ws: WebSocket) {
  browserSockets.add(ws);
  ws.on("close", () => browserSockets.delete(ws));
}

export function sendToAgent(agentId: string, message: DashboardMessage): boolean {
  const conn = connections.get(agentId);
  if (!conn || conn.socket.readyState !== 1 /* WebSocket.OPEN */) return false;
  conn.socket.send(JSON.stringify(message));
  return true;
}

export async function handleAgentSocket(
  socket: WebSocket,
  sourceIp: string,
  log: FastifyBaseLogger
) {
  const conn: AgentConnection = {
    socket,
    agentId: "",
    hostname: "",
    authenticated: false,
    sourceIp,
  };

  // Agent must authenticate within 10 seconds
  const authTimeout = setTimeout(() => {
    if (!conn.authenticated) {
      log.warn("Agent connection from %s timed out waiting for auth", sourceIp);
      socket.close(4001, "authentication timeout");
    }
  }, 10_000);

  socket.on("message", async (raw: Buffer) => {
    let msg: AgentMessage;
    try {
      msg = JSON.parse(raw.toString()) as AgentMessage;
    } catch {
      log.warn("Invalid JSON from agent %s", conn.agentId || sourceIp);
      return;
    }

    if (!conn.authenticated) {
      if (msg.type !== "auth") {
        socket.close(4002, "first message must be auth");
        return;
      }
      clearTimeout(authTimeout);
      await handleAuth(conn, msg as AuthMessage, log);
      return;
    }

    switch (msg.type) {
      case "heartbeat":
        await handleHeartbeat(conn, msg as HeartbeatMessage, log);
        break;
      case "state_snapshot":
        await handleStateSnapshot(conn, msg as StateSnapshotMessage, log);
        break;
      case "operation_log":
        handleOperationLog(conn, msg as OperationLogMessage);
        break;
      case "operation_result":
        await handleOperationResult(conn, msg as OperationResultMessage, log);
        break;
      default:
        log.debug("Unknown message type from agent %s: %s", conn.agentId, msg.type);
    }
  });

  socket.on("close", () => {
    clearTimeout(authTimeout);
    if (conn.agentId) {
      connections.delete(conn.agentId);
      log.info("Agent %s disconnected", conn.agentId);
      // Mark agent as offline
      db.update(agents)
        .set({ status: "offline" })
        .where(eq(agents.id, conn.agentId))
        .then(() => {})
        .catch((err) => log.error(err, "Failed to mark agent offline"));
    }
  });
}

async function handleAuth(
  conn: AgentConnection,
  msg: AuthMessage,
  log: FastifyBaseLogger
) {
  if (msg.protocolVersion !== PROTOCOL_VERSION) {
    conn.socket.close(4003, `unsupported protocol version: ${msg.protocolVersion}, expected ${PROTOCOL_VERSION}`);
    return;
  }

  const result = await validateAgentCredential(msg.agentId, msg.secret, conn.sourceIp);
  if (!result.valid) {
    log.warn("Auth failed for agent %s from %s: %s", msg.agentId, conn.sourceIp, result.error);
    conn.socket.close(4004, "authentication failed");
    return;
  }

  if (result.revoked) {
    conn.socket.send(JSON.stringify({ type: "revoked", reason: "agent enrollment revoked" }));
    conn.socket.close(4005, "agent revoked");
    return;
  }

  // Check for duplicate connection
  const existing = connections.get(msg.agentId);
  if (existing) {
    log.warn("Duplicate connection for agent %s — closing old connection", msg.agentId);
    existing.socket.close(4006, "superseded by new connection");
    connections.delete(msg.agentId);
  }

  conn.agentId = msg.agentId;
  conn.hostname = result.hostname;
  conn.authenticated = true;
  connections.set(msg.agentId, conn);

  log.info("Agent %s (%s) authenticated from %s", msg.agentId, result.hostname, conn.sourceIp);
  conn.socket.send(JSON.stringify({ type: "ack" }));
}

async function handleHeartbeat(
  conn: AgentConnection,
  msg: HeartbeatMessage,
  log: FastifyBaseLogger
) {
  await db
    .update(agents)
    .set({
      status: "online",
      lastHeartbeat: new Date(),
      agentVersion: msg.version,
    })
    .where(eq(agents.id, conn.agentId));

  log.debug("Heartbeat from %s (%s)", conn.agentId, conn.hostname);
}

async function handleStateSnapshot(
  conn: AgentConnection,
  msg: StateSnapshotMessage,
  log: FastifyBaseLogger
) {
  // Store snapshot in audit log for now (dedicated state_snapshots table deferred)
  await db.insert(auditLog).values({
    agentId: conn.agentId,
    initiatedBy: "agent",
    operationType: "state_snapshot",
    status: "completed",
    logText: JSON.stringify({
      full: msg.full,
      installedCount: msg.installedPackages.length,
      pendingUpdateCount: msg.pendingUpdates.length,
      sourceCount: msg.sources.length,
    }),
  });

  log.debug(
    "State snapshot from %s: %d installed, %d updates",
    conn.agentId,
    msg.installedPackages.length,
    msg.pendingUpdates.length
  );
}

function handleOperationLog(conn: AgentConnection, msg: OperationLogMessage) {
  // Forward to all connected browser clients
  const forward = JSON.stringify(msg);
  for (const browser of browserSockets) {
    if (browser.readyState === 1) browser.send(forward);
  }
}

async function handleOperationResult(
  conn: AgentConnection,
  msg: OperationResultMessage,
  log: FastifyBaseLogger
) {
  await db.insert(auditLog).values({
    agentId: conn.agentId,
    initiatedBy: "agent",
    operationType: "operation_result",
    status: msg.status,
    logText: JSON.stringify({ operationId: msg.operationId }),
  });

  log.info("Operation %s on %s: %s", msg.operationId, conn.agentId, msg.status);

  // Forward to browser clients
  const forward = JSON.stringify(msg);
  for (const browser of browserSockets) {
    if (browser.readyState === 1) browser.send(forward);
  }
}
