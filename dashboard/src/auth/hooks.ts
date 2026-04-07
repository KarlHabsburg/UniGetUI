import type { FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import { validateLocalCredentials, checkRateLimit } from "./local.js";
import { isOidcEnabled, getAuthorizationUrl, handleCallback } from "./oidc.js";
import { randomBytes } from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET ?? randomBytes(32).toString("hex");
const JWT_EXPIRY = "15m";
const LOCAL_AUTH_DISABLED = process.env.DISABLE_LOCAL_AUTH === "true";

/**
 * Register authentication routes and JWT plugin on a Fastify instance.
 */
export async function registerAuth(app: FastifyInstance) {
  await app.register(jwt, {
    secret: JWT_SECRET,
    sign: { expiresIn: JWT_EXPIRY },
  });

  await app.register(cookie);

  // POST /api/auth/login — local username/password login
  app.post("/api/auth/login", async (request, reply) => {
    if (LOCAL_AUTH_DISABLED) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Local authentication is disabled — use OIDC",
      });
    }

    const { email, password } = request.body as { email?: string; password?: string };
    if (!email || !password) {
      return reply.status(400).send({ error: "Bad Request", message: "email and password required" });
    }

    const ip = request.ip;
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      reply.header("Retry-After", Math.ceil((rateCheck.retryAfterMs ?? 0) / 1000).toString());
      return reply.status(429).send({
        error: "Too Many Requests",
        message: "Rate limit exceeded — try again later",
      });
    }

    const user = await validateLocalCredentials(email, password);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized", message: "Invalid credentials" });
    }

    const token = app.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
    });

    reply.setCookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 15 * 60, // 15 minutes
    });

    return reply.send({ token, user: { id: user.id, email: user.email, role: user.role } });
  });

  // GET /api/auth/oidc/login — redirect to OIDC provider
  app.get("/api/auth/oidc/login", async (_request, reply) => {
    if (!isOidcEnabled()) {
      return reply.status(404).send({ error: "Not Found", message: "OIDC is not configured" });
    }

    const redirectUri = `${process.env.DASHBOARD_URL ?? "http://localhost"}/api/auth/oidc/callback`;
    const state = randomBytes(16).toString("hex");
    const url = getAuthorizationUrl(redirectUri, state);
    return reply.redirect(url);
  });

  // GET /api/auth/oidc/callback — handle OIDC provider response
  app.get("/api/auth/oidc/callback", async (request, reply) => {
    if (!isOidcEnabled()) {
      return reply.status(404).send({ error: "Not Found", message: "OIDC is not configured" });
    }

    const { code } = request.query as { code?: string };
    if (!code) {
      return reply.status(400).send({ error: "Bad Request", message: "Missing authorization code" });
    }

    try {
      const redirectUri = `${process.env.DASHBOARD_URL ?? "http://localhost"}/api/auth/oidc/callback`;
      const user = await handleCallback(code, redirectUri);

      const token = app.jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
      });

      reply.setCookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 15 * 60,
      });

      // Redirect to dashboard UI
      return reply.redirect("/");
    } catch (err) {
      app.log.error(err, "OIDC callback failed");
      return reply.status(500).send({ error: "Internal Server Error", message: "OIDC authentication failed" });
    }
  });

  // GET /api/auth/me — returns the current user from the JWT
  app.get("/api/auth/me", async (request, reply) => {
    try {
      await request.jwtVerify();
      return reply.send({ user: request.user });
    } catch {
      return reply.status(401).send({ error: "Unauthorized", message: "Not authenticated" });
    }
  });

  // Decorate requests with JWT verification (non-blocking — routes opt in via requireRole)
  app.addHook("onRequest", async (request) => {
    try {
      // Try Authorization header first, then cookie
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        await request.jwtVerify();
      } else if (request.cookies?.token) {
        await request.jwtVerify({ onlyCookie: true });
      }
    } catch {
      // Not authenticated — that's fine, protected routes will check via requireRole
    }
  });
}
