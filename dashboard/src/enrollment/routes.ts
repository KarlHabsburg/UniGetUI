import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/rbac.js";
import {
  generateEnrollmentToken,
  consumeEnrollmentToken,
  checkEnrollmentRateLimit,
  revokeAgent,
} from "./tokens.js";
import { db } from "../db/connection.js";
import { agents } from "../db/schema.js";
import { eq } from "drizzle-orm";

export async function registerEnrollmentRoutes(app: FastifyInstance) {
  // POST /api/enrollment/tokens — generate a one-time enrollment token
  app.post(
    "/api/enrollment/tokens",
    { preHandler: requireRole("Operator") },
    async (request, reply) => {
      const user = request.user as { sub: string };
      const body = request.body as { expiryMinutes?: number } | undefined;

      const result = await generateEnrollmentToken(
        user.sub,
        body?.expiryMinutes
      );

      return reply.status(201).send({
        token: result.token,
        tokenId: result.tokenId,
        expiresAt: result.expiresAt.toISOString(),
        message: "Save this token — it will not be shown again",
      });
    }
  );

  // POST /api/enrollment/enroll — agent presents a one-time token to enroll
  app.post("/api/enrollment/enroll", async (request, reply) => {
    const ip = request.ip;
    if (!checkEnrollmentRateLimit(ip)) {
      return reply.status(429).send({
        error: "Too Many Requests",
        message: "Enrollment rate limit exceeded",
      });
    }

    const { token, hostname } = request.body as {
      token?: string;
      hostname?: string;
    };
    if (!token || !hostname) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "token and hostname are required",
      });
    }

    const result = await consumeEnrollmentToken(token, hostname, ip);
    if ("error" in result) {
      const status = result.error === "invalid token" ? 401 : 400;
      return reply.status(status).send({ error: result.error });
    }

    // Never log the secret (R31)
    app.log.info(
      "Agent enrolled: %s (hostname: %s, IP: %s)",
      result.agentId,
      hostname,
      ip
    );

    return reply.status(201).send({
      agentId: result.agentId,
      secret: result.secret,
    });
  });

  // GET /api/agents — list all enrolled agents
  app.get(
    "/api/agents",
    { preHandler: requireRole("ReadOnly") },
    async (_request, reply) => {
      const rows = await db.select().from(agents);
      return reply.send(
        rows.map((a) => ({
          id: a.id,
          hostname: a.hostname,
          agentVersion: a.agentVersion,
          status: a.status,
          tags: a.tags,
          lastHeartbeat: a.lastHeartbeat?.toISOString() ?? null,
          enrolledAt: a.enrolledAt.toISOString(),
          revoked: a.revoked !== 0,
        }))
      );
    }
  );

  // GET /api/agents/:id — get agent detail
  app.get(
    "/api/agents/:id",
    { preHandler: requireRole("ReadOnly") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, id))
        .limit(1);

      if (!agent) {
        return reply.status(404).send({ error: "Agent not found" });
      }

      return reply.send({
        id: agent.id,
        hostname: agent.hostname,
        agentVersion: agent.agentVersion,
        status: agent.status,
        tags: agent.tags,
        lastHeartbeat: agent.lastHeartbeat?.toISOString() ?? null,
        enrolledAt: agent.enrolledAt.toISOString(),
        revoked: agent.revoked !== 0,
        // Placeholder — populated by state snapshots in Unit 7
        installedPackages: [],
        pendingUpdates: [],
      });
    }
  );

  // POST /api/agents/:id/revoke — revoke an agent's enrollment
  app.post(
    "/api/agents/:id/revoke",
    { preHandler: requireRole("SecurityAdmin") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await revokeAgent(id);
      return reply.send({ status: "revoked", agentId: id });
    }
  );

  // POST /api/agents/:id/tags — update agent tags
  app.post(
    "/api/agents/:id/tags",
    { preHandler: requireRole("Operator") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { tags } = request.body as { tags: string[] };

      await db
        .update(agents)
        .set({ tags })
        .where(eq(agents.id, id));

      return reply.send({ status: "updated", agentId: id, tags });
    }
  );
}
