import { db } from "../db/connection.js";
import { policies } from "../db/schema.js";
import { eq } from "drizzle-orm";

interface ApprovalCriteria {
  elevated: boolean;
  nonAllowlistedSource: boolean;
  firstTimePackage: boolean;
}

/**
 * Evaluate whether an operation requires approval based on configured criteria.
 */
export async function requiresApproval(params: {
  elevated: boolean;
  nonAllowlistedSource: boolean;
  firstTimePackage: boolean;
}): Promise<boolean> {
  const [row] = await db
    .select()
    .from(policies)
    .where(eq(policies.type, "approval_criteria"))
    .limit(1);

  if (!row) return false; // No approval policy configured — allow all

  const criteria = row.configJson as unknown as ApprovalCriteria;

  return (
    (criteria.elevated && params.elevated) ||
    (criteria.nonAllowlistedSource && params.nonAllowlistedSource) ||
    (criteria.firstTimePackage && params.firstTimePackage)
  );
}
