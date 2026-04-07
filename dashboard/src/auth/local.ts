import bcrypt from "bcrypt";
import { db } from "../db/connection.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Role } from "./rbac.js";

const SALT_ROUNDS = 12;

/**
 * Rate limiter for login attempts — 5 attempts per 15 minutes per IP.
 */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true };
}

export function resetRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

/**
 * Validates email + password against the local user database.
 * Returns the user record on success, null on failure.
 */
export async function validateLocalCredentials(
  email: string,
  password: string
): Promise<{ id: string; email: string; role: Role; displayName: string } | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user || !user.passwordHash) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  return {
    id: user.id,
    email: user.email,
    role: user.role as Role,
    displayName: user.displayName,
  };
}

/**
 * Creates a local user with a hashed password.
 */
export async function createLocalUser(
  email: string,
  password: string,
  role: Role,
  displayName?: string
): Promise<string> {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      role,
      displayName: displayName ?? email,
      authProvider: "local",
    })
    .returning({ id: users.id });

  return user.id;
}
