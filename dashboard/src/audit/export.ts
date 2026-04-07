import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/rbac.js";
import { db } from "../db/connection.js";
import { auditLog } from "../db/schema.js";
import { desc, gte, lte, and } from "drizzle-orm";

export async function registerAuditExportRoutes(app: FastifyInstance) {
  // GET /api/audit/export — stream audit log as CSV or JSON
  app.get(
    "/api/audit/export",
    { preHandler: requireRole("Operator") },
    async (request, reply) => {
      const query = request.query as {
        format?: "csv" | "json";
        from?: string;
        to?: string;
      };

      const format = query.format ?? "json";
      const conditions = [];

      if (query.from) {
        conditions.push(gte(auditLog.loggedAt, new Date(query.from)));
      }
      if (query.to) {
        conditions.push(lte(auditLog.loggedAt, new Date(query.to)));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const entries = await db
        .select()
        .from(auditLog)
        .where(whereClause)
        .orderBy(desc(auditLog.loggedAt))
        .limit(100_000);

      if (format === "csv") {
        reply.header("Content-Type", "text/csv");
        reply.header("Content-Disposition", "attachment; filename=audit-log.csv");

        const header = "id,agent_id,initiated_by,operation_type,package_id,manager,version,status,logged_at\n";
        const rows = entries
          .map(
            (e) =>
              `${e.id},${e.agentId ?? ""},${csvEscape(e.initiatedBy)},${e.operationType},${csvEscape(e.packageId)},${e.manager},${e.version},${e.status},${e.loggedAt.toISOString()}`
          )
          .join("\n");

        return reply.send(header + rows);
      }

      reply.header("Content-Type", "application/json");
      reply.header("Content-Disposition", "attachment; filename=audit-log.json");
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

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
