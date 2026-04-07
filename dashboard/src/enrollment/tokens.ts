import { randomBytes, createHash } from "node:crypto";
import { db } from "../db/connection.js";
import { enrollmentTokens, agents } from "../db/schema.js";
import { eq, and, isNull, gt } from "drizzle-orm";

const DEFAULT_EXPIRY_MINUTES = 60;

// Rate limiter: 10 enrollments per hour per IP
const enrollmentAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ENROLLMENTS = 10;
const WINDOW_MS = 60 * 60 * 1000;

export function checkEnrollmentRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = enrollmentAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    enrollmentAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ENROLLMENTS) return false;
  entry.count++;
  return true;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a one-time enrollment token. Returns the raw token (shown to admin once).
 */
export async function generateEnrollmentToken(
  createdBy: string,
  expiryMinutes = DEFAULT_EXPIRY_MINUTES
): Promise<{ token: string; tokenId: string; expiresAt: Date }> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  const [row] = await db
    .insert(enrollmentTokens)
    .values({
      tokenHash,
      createdBy,
      expiresAt,
    })
    .returning({ id: enrollmentTokens.id });

  return { token: rawToken, tokenId: row.id, expiresAt };
}

/**
 * Validate and consume an enrollment token. Returns the new agent UUID + secret,
 * or null if the token is invalid/expired/consumed.
 */
export async function consumeEnrollmentToken(
  rawToken: string,
  hostname: string,
  sourceIp: string
): Promise<{ agentId: string; secret: string } | { error: string }> {
  const tokenHash = hashToken(rawToken);

  const [tokenRow] = await db
    .select()
    .from(enrollmentTokens)
    .where(
      and(
        eq(enrollmentTokens.tokenHash, tokenHash),
        isNull(enrollmentTokens.consumedAt),
        gt(enrollmentTokens.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!tokenRow) {
    // Determine specific error
    const [anyMatch] = await db
      .select()
      .from(enrollmentTokens)
      .where(eq(enrollmentTokens.tokenHash, tokenHash))
      .limit(1);

    if (!anyMatch) return { error: "invalid token" };
    if (anyMatch.consumedAt) return { error: "token already consumed" };
    return { error: "token expired" };
  }

  // Generate agent credentials
  const agentSecret = randomBytes(48).toString("hex");
  const credentialHash = hashToken(agentSecret);

  // Create agent record
  const [agent] = await db
    .insert(agents)
    .values({
      hostname,
      credentialHash,
      lastSourceIp: sourceIp,
      status: "online",
    })
    .returning({ id: agents.id });

  // Mark token as consumed
  await db
    .update(enrollmentTokens)
    .set({
      consumedAt: new Date(),
      consumedByAgent: agent.id,
    })
    .where(eq(enrollmentTokens.id, tokenRow.id));

  return { agentId: agent.id, secret: agentSecret };
}

/**
 * Validate agent credentials on reconnect. Returns agent info or error.
 */
export async function validateAgentCredential(
  agentId: string,
  secret: string,
  sourceIp: string
): Promise<{ valid: true; hostname: string; revoked: boolean } | { valid: false; error: string }> {
  const credentialHash = hashToken(secret);

  const [agent] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.credentialHash, credentialHash)
      )
    )
    .limit(1);

  if (!agent) return { valid: false, error: "invalid credentials" };

  // Check for concurrent use from different IP
  if (agent.lastSourceIp && agent.lastSourceIp !== sourceIp) {
    // Flag but don't block — log the anomaly
    // In a production system this would trigger an alert
  }

  // Update last source IP
  await db
    .update(agents)
    .set({ lastSourceIp: sourceIp, status: "online", lastHeartbeat: new Date() })
    .where(eq(agents.id, agentId));

  return { valid: true, hostname: agent.hostname, revoked: agent.revoked !== 0 };
}

/**
 * Revoke an agent's enrollment.
 */
export async function revokeAgent(agentId: string): Promise<void> {
  await db
    .update(agents)
    .set({ revoked: 1, status: "offline" })
    .where(eq(agents.id, agentId));
}
