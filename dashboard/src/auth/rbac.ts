import type { FastifyRequest, FastifyReply } from "fastify";

export const Roles = ["ReadOnly", "Operator", "Approver", "SecurityAdmin"] as const;
export type Role = (typeof Roles)[number];

/**
 * Role hierarchy — each role includes all permissions of roles below it.
 * SecurityAdmin > Approver > Operator > ReadOnly
 */
const ROLE_LEVEL: Record<Role, number> = {
  ReadOnly: 0,
  Operator: 1,
  Approver: 2,
  SecurityAdmin: 3,
};

export function isValidRole(role: string): role is Role {
  return Roles.includes(role as Role);
}

export function hasRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[requiredRole];
}

/**
 * Fastify preHandler hook factory — checks that the authenticated user
 * has at least the required role.
 */
export function requireRole(requiredRole: Role) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { role?: string; sub?: string } | undefined;
    if (!user?.role || !isValidRole(user.role)) {
      return reply.status(403).send({ error: "Forbidden", message: "Invalid or missing role" });
    }

    if (!hasRole(user.role, requiredRole)) {
      return reply.status(403).send({
        error: "Forbidden",
        message: `Requires ${requiredRole} role or above`,
      });
    }
  };
}

/**
 * Checks that the current user is not the initiator of an operation.
 * Used to enforce the no-self-approval constraint (R19).
 */
export function denyIfSelf(initiatedBy: string, currentUserId: string): string | null {
  if (initiatedBy === currentUserId) {
    return "self-approval denied — an approver cannot approve their own operation";
  }
  return null;
}
