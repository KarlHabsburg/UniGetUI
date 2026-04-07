import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { db } from "./db/connection.js";
import { agents } from "./db/schema.js";
import { sql } from "drizzle-orm";
import { registerAuth } from "./auth/hooks.js";
import { initOidc } from "./auth/oidc.js";
import { registerEnrollmentRoutes } from "./enrollment/routes.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  // Auth
  const oidcReady = await initOidc();
  app.log.info(oidcReady ? "OIDC authentication enabled" : "OIDC not configured — local auth only");
  await registerAuth(app);

  // Routes
  await registerEnrollmentRoutes(app);

  // Health check
  app.get("/api/health", async (_request, reply) => {
    try {
      // Verify DB connectivity
      await db.execute(sql`SELECT 1`);

      const agentRows = await db.select().from(agents);
      const online = agentRows.filter((a) => a.status === "online").length;

      return reply.send({
        status: "healthy",
        database: "connected",
        agents: {
          total: agentRows.length,
          online,
        },
      });
    } catch (error) {
      app.log.error(error, "Health check failed");
      return reply.status(503).send({
        status: "unhealthy",
        database: "disconnected",
      });
    }
  });

  // WebSocket endpoint for agent connections (placeholder for Unit 7)
  app.get("/ws/agent", { websocket: true }, (socket, _request) => {
    socket.on("message", (message: Buffer) => {
      app.log.info("Agent message received: %s", message.toString().slice(0, 200));
      socket.send(JSON.stringify({ type: "ack" }));
    });

    socket.on("close", () => {
      app.log.info("Agent WebSocket disconnected");
    });
  });

  return app;
}

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`UniGetUI Dashboard API listening on ${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
