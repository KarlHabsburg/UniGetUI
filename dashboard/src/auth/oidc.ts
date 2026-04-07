import * as client from "openid-client";
import { db } from "../db/connection.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Role } from "./rbac.js";

let oidcConfig: client.Configuration | null = null;

/**
 * Initialize the OIDC client from environment variables.
 * Call once at server startup. If OIDC_ISSUER is not set, OIDC is disabled.
 */
export async function initOidc(): Promise<boolean> {
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;

  if (!issuer || !clientId) {
    return false;
  }

  oidcConfig = await client.discovery(
    new URL(issuer),
    clientId,
    clientSecret ?? undefined,
  );

  return true;
}

export function isOidcEnabled(): boolean {
  return oidcConfig !== null;
}

/**
 * Generate an authorization URL for the OIDC login flow.
 */
export function getAuthorizationUrl(redirectUri: string, state: string): string {
  if (!oidcConfig) throw new Error("OIDC not initialized");

  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    scope: "openid email profile",
    state,
    response_type: "code",
  });

  const authEndpoint = oidcConfig.serverMetadata().authorization_endpoint;
  if (!authEndpoint) throw new Error("OIDC provider has no authorization_endpoint");

  return `${authEndpoint}?${params.toString()}&client_id=${oidcConfig.serverMetadata().issuer ? process.env.OIDC_CLIENT_ID : ""}`;
}

/**
 * Exchange an authorization code for tokens, extract user info,
 * and upsert the user in the local database.
 */
export async function handleCallback(
  code: string,
  redirectUri: string
): Promise<{ id: string; email: string; role: Role; displayName: string }> {
  if (!oidcConfig) throw new Error("OIDC not initialized");

  const tokens = await client.authorizationCodeGrant(oidcConfig, new URL(`${redirectUri}?code=${code}`), {
    expectedState: undefined,
  });

  const claims = tokens.claims();
  if (!claims) throw new Error("No claims in token response");

  const email = claims.email as string | undefined;
  if (!email) throw new Error("OIDC provider did not return an email claim");

  const displayName = (claims.name as string) ?? email;

  // Upsert user — if they exist, return them. If new, create with ReadOnly role.
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    return {
      id: existing.id,
      email: existing.email,
      role: existing.role as Role,
      displayName: existing.displayName,
    };
  }

  const [created] = await db
    .insert(users)
    .values({
      email,
      displayName,
      role: "ReadOnly",
      authProvider: "oidc",
    })
    .returning({ id: users.id });

  return { id: created.id, email, role: "ReadOnly", displayName };
}
