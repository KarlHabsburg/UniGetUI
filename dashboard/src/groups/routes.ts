import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/rbac.js";
import { db } from "../db/connection.js";
import { agents } from "../db/schema.js";

export async function registerGroupRoutes(app: FastifyInstance) {
  // GET /api/groups — list all unique tags across the fleet
  app.get(
    "/api/groups",
    { preHandler: requireRole("ReadOnly") },
    async (_request, reply) => {
      const allAgents = await db.select({ tags: agents.tags }).from(agents);
      const tagCounts = new Map<string, number>();

      for (const agent of allAgents) {
        const tags = agent.tags as string[];
        for (const tag of tags) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }

      const groups = Array.from(tagCounts.entries())
        .map(([name, count]) => ({ name, machineCount: count }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return reply.send(groups);
    }
  );
}
