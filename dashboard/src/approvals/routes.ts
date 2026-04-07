import type { FastifyInstance } from "fastify";
import { requireRole, denyIfSelf } from "../auth/rbac.js";
import { db } from "../db/connection.js";
import { auditLog } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { sendToAgent } from "../protocol/agentHandler.js";

// In-memory pending approvals (production would use a dedicated table)
interface PendingApproval {
  id: string;
  agentId: string;
  operationId: string;
  packageId: string;
  manager: string;
  action: string;
  reason: string;
  initiatedBy: string;
  createdAt: Date;
  expiresAt: Date;
}

const pendingApprovals = new Map<string, PendingApproval>();
const DEFAULT_APPROVAL_TIMEOUT_HOURS = 24;

export async function registerApprovalRoutes(app: FastifyInstance) {
  // GET /api/approvals — list pending approvals
  app.get(
    "/api/approvals",
    { preHandler: requireRole("Approver") },
    async (_request, reply) => {
      const now = new Date();
      const pending: PendingApproval[] = [];

      for (const [id, approval] of pendingApprovals) {
        if (now > approval.expiresAt) {
          // Auto-deny expired approvals
          pendingApprovals.delete(id);
          sendToAgent(approval.agentId, {
            type: "approval_response",
            operationId: approval.operationId,
            approved: false,
          });
          app.log.info("Approval %s auto-denied (expired)", id);
        } else {
          pending.push(approval);
        }
      }

      return reply.send(
        pending.map((a) => ({
          id: a.id,
          agentId: a.agentId,
          operationId: a.operationId,
          packageId: a.packageId,
          manager: a.manager,
          action: a.action,
          reason: a.reason,
          initiatedBy: a.initiatedBy,
          createdAt: a.createdAt.toISOString(),
          expiresAt: a.expiresAt.toISOString(),
        }))
      );
    }
  );

  // POST /api/approvals/:id/approve — approve a pending operation
  app.post(
    "/api/approvals/:id/approve",
    { preHandler: requireRole("Approver") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.user as { sub: string; email: string };

      const approval = pendingApprovals.get(id);
      if (!approval) {
        return reply.status(404).send({ error: "Approval not found or expired" });
      }

      // R19: no self-approval
      const selfDenial = denyIfSelf(approval.initiatedBy, user.sub);
      if (selfDenial) {
        return reply.status(403).send({ error: "Forbidden", message: selfDenial });
      }

      pendingApprovals.delete(id);

      sendToAgent(approval.agentId, {
        type: "approval_response",
        operationId: approval.operationId,
        approved: true,
      });

      // Audit
      await db.insert(auditLog).values({
        agentId: approval.agentId,
        initiatedBy: user.email,
        operationType: "approval_granted",
        packageId: approval.packageId,
        manager: approval.manager,
        status: "completed",
        logText: `Approved by ${user.email} for operation ${approval.operationId}`,
      });

      app.log.info("Approval %s granted by %s", id, user.email);
      return reply.send({ status: "approved", operationId: approval.operationId });
    }
  );

  // POST /api/approvals/:id/deny — deny a pending operation
  app.post(
    "/api/approvals/:id/deny",
    { preHandler: requireRole("Approver") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.user as { sub: string; email: string };

      const approval = pendingApprovals.get(id);
      if (!approval) {
        return reply.status(404).send({ error: "Approval not found or expired" });
      }

      pendingApprovals.delete(id);

      sendToAgent(approval.agentId, {
        type: "approval_response",
        operationId: approval.operationId,
        approved: false,
      });

      await db.insert(auditLog).values({
        agentId: approval.agentId,
        initiatedBy: user.email,
        operationType: "approval_denied",
        packageId: approval.packageId,
        manager: approval.manager,
        status: "completed",
        logText: `Denied by ${user.email} for operation ${approval.operationId}`,
      });

      app.log.info("Approval %s denied by %s", id, user.email);
      return reply.send({ status: "denied", operationId: approval.operationId });
    }
  );
}

/**
 * Register a pending approval from an agent's approval_request message.
 */
export function createPendingApproval(
  agentId: string,
  operationId: string,
  packageId: string,
  manager: string,
  action: string,
  reason: string,
  initiatedBy: string
): string {
  const id = crypto.randomUUID();
  pendingApprovals.set(id, {
    id,
    agentId,
    operationId,
    packageId,
    manager,
    action,
    reason,
    initiatedBy,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + DEFAULT_APPROVAL_TIMEOUT_HOURS * 60 * 60 * 1000),
  });
  return id;
}
