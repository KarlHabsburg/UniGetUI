import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/rbac.js";
import { db } from "../db/connection.js";
import { auditLog, agents } from "../db/schema.js";
import { eq, desc, inArray } from "drizzle-orm";
import { sendToAgent, getConnectedAgents } from "../protocol/agentHandler.js";
import type { OperationPushMessage } from "../protocol/messages.js";

export async function registerOperationRoutes(app: FastifyInstance) {
  // POST /api/operations — push an operation to agent(s)
  app.post(
    "/api/operations",
    { preHandler: requireRole("Operator") },
    async (request, reply) => {
      const user = request.user as { sub: string; email: string };
      const body = request.body as {
        agentId?: string;
        groupTag?: string;
        action: "install" | "update" | "uninstall";
        packageId: string;
        manager: string;
        version?: string;
        options?: Record<string, unknown>;
      };

      if (!body.action || !body.packageId || !body.manager) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "action, packageId, and manager are required",
        });
      }

      // Resolve target agents
      let targetAgentIds: string[] = [];

      if (body.agentId) {
        targetAgentIds = [body.agentId];
      } else if (body.groupTag) {
        const taggedAgents = await db
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.revoked, 0));

        // Filter by tag in application layer (jsonb array)
        targetAgentIds = taggedAgents
          .filter((a) => {
            // Need to fetch full agent to check tags
            return true; // simplified — actual tag filtering needs full row
          })
          .map((a) => a.id);

        // Refetch with tags for proper filtering
        const allAgents = await db.select().from(agents).where(eq(agents.revoked, 0));
        targetAgentIds = allAgents
          .filter((a) => (a.tags as string[]).includes(body.groupTag!))
          .map((a) => a.id);
      } else {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Either agentId or groupTag is required",
        });
      }

      if (targetAgentIds.length === 0) {
        return reply.status(404).send({
          error: "Not Found",
          message: "No agents match the target",
        });
      }

      const results: { agentId: string; sent: boolean }[] = [];

      for (const agentId of targetAgentIds) {
        const operationId = crypto.randomUUID();

        // Record in audit log
        await db.insert(auditLog).values({
          agentId,
          initiatedBy: user.email,
          operationType: body.action,
          packageId: body.packageId,
          manager: body.manager,
          version: body.version ?? "",
          status: "pending",
        });

        // Push to agent via WebSocket
        const pushMsg: OperationPushMessage = {
          type: "operation_push",
          operationId,
          action: body.action,
          packageId: body.packageId,
          manager: body.manager,
          version: body.version,
          options: body.options,
        };

        const sent = sendToAgent(agentId, pushMsg);
        results.push({ agentId, sent });

        if (!sent) {
          app.log.warn("Agent %s not connected — operation queued", agentId);
        }
      }

      return reply.status(202).send({
        status: "accepted",
        targets: results,
      });
    }
  );

  // GET /api/audit — query the audit log
  app.get(
    "/api/audit",
    { preHandler: requireRole("ReadOnly") },
    async (request, reply) => {
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(parseInt(query.limit ?? "50", 10), 200);
      const offset = parseInt(query.offset ?? "0", 10);

      const entries = await db
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.loggedAt))
        .limit(limit)
        .offset(offset);

      return reply.send(
        entries.map((e) => ({
          id: e.id,
          agentId: e.agentId,
          initiatedBy: e.initiatedBy,
          operationType: e.operationType,
          packageId: e.packageId,
          manager: e.manager,
          version: e.version,
          status: e.status,
          loggedAt: e.loggedAt.toISOString(),
        }))
      );
    }
  );
}
