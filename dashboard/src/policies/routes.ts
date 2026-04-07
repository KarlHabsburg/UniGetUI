import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/rbac.js";
import { db } from "../db/connection.js";
import { policies } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getConnectedAgents, sendToAgent } from "../protocol/agentHandler.js";
import type { PolicyTypeName } from "./types.js";

const VALID_POLICY_TYPES: PolicyTypeName[] = [
  "source_allowlist",
  "package_blocklist",
  "hash_policy",
  "command_allowlist",
  "approval_criteria",
];

const DEFAULT_POLICY_TTL_SECONDS = 3600; // 1 hour

export async function registerPolicyRoutes(app: FastifyInstance) {
  // GET /api/policies — list all policies
  app.get(
    "/api/policies",
    { preHandler: requireRole("ReadOnly") },
    async (_request, reply) => {
      const rows = await db.select().from(policies);
      return reply.send(
        rows.map((p) => ({
          id: p.id,
          type: p.type,
          config: p.configJson,
          updatedBy: p.updatedBy,
          updatedAt: p.updatedAt.toISOString(),
        }))
      );
    }
  );

  // GET /api/policies/:type — get a specific policy by type
  app.get(
    "/api/policies/:type",
    { preHandler: requireRole("ReadOnly") },
    async (request, reply) => {
      const { type } = request.params as { type: string };
      const [row] = await db
        .select()
        .from(policies)
        .where(eq(policies.type, type))
        .limit(1);

      if (!row) {
        return reply.status(404).send({ error: "Policy not found" });
      }

      return reply.send({
        id: row.id,
        type: row.type,
        config: row.configJson,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.toISOString(),
      });
    }
  );

  // PUT /api/policies/:type — create or update a policy (SecurityAdmin only)
  app.put(
    "/api/policies/:type",
    { preHandler: requireRole("SecurityAdmin") },
    async (request, reply) => {
      const { type } = request.params as { type: string };
      const user = request.user as { sub: string };
      const body = request.body as { config: Record<string, unknown> };

      if (!VALID_POLICY_TYPES.includes(type as PolicyTypeName)) {
        return reply.status(400).send({
          error: "Bad Request",
          message: `Invalid policy type. Valid types: ${VALID_POLICY_TYPES.join(", ")}`,
        });
      }

      if (!body?.config) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "config is required",
        });
      }

      // Upsert policy
      const [existing] = await db
        .select()
        .from(policies)
        .where(eq(policies.type, type))
        .limit(1);

      if (existing) {
        await db
          .update(policies)
          .set({
            configJson: body.config,
            updatedBy: user.sub,
            updatedAt: new Date(),
          })
          .where(eq(policies.id, existing.id));
      } else {
        await db.insert(policies).values({
          type,
          configJson: body.config,
          updatedBy: user.sub,
        });
      }

      // Push updated policies to all connected agents
      await pushPoliciesToAllAgents(app);

      return reply.send({ status: "updated", type });
    }
  );

  // DELETE /api/policies/:type — remove a policy (SecurityAdmin only)
  app.delete(
    "/api/policies/:type",
    { preHandler: requireRole("SecurityAdmin") },
    async (request, reply) => {
      const { type } = request.params as { type: string };
      await db.delete(policies).where(eq(policies.type, type));

      await pushPoliciesToAllAgents(app);

      return reply.send({ status: "deleted", type });
    }
  );
}

/** Build the full policy document and push it to all connected agents. */
async function pushPoliciesToAllAgents(app: FastifyInstance) {
  const allPolicies = await db.select().from(policies);

  const policyDocument: Record<string, unknown> = {};
  for (const p of allPolicies) {
    policyDocument[p.type] = p.configJson;
  }

  const message = {
    type: "policy_sync",
    policies: policyDocument,
    ttlSeconds: DEFAULT_POLICY_TTL_SECONDS,
  };

  const agents = getConnectedAgents();
  let pushed = 0;
  for (const [agentId] of agents) {
    if (sendToAgent(agentId, message as any)) pushed++;
  }

  app.log.info("Policy sync pushed to %d connected agents", pushed);
}
