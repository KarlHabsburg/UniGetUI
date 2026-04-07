import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  serial,
  index,
} from "drizzle-orm/pg-core";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostname: text("hostname").notNull(),
    agentVersion: text("agent_version").notNull().default(""),
    status: text("status").notNull().default("offline"), // online, offline, degraded
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
    credentialHash: text("credential_hash").notNull(),
    lastSourceIp: text("last_source_ip"),
    revoked: integer("revoked").notNull().default(0),
  },
  (table) => [
    index("idx_agents_status").on(table.status),
  ]
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  role: text("role").notNull().default("ReadOnly"), // ReadOnly, Operator, Approver, SecurityAdmin
  authProvider: text("auth_provider").notNull().default("local"), // local, oidc
  passwordHash: text("password_hash"), // null for OIDC-only users
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const enrollmentTokens = pgTable(
  "enrollment_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedByAgent: uuid("consumed_by_agent").references(() => agents.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_enrollment_tokens_hash").on(table.tokenHash),
  ]
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    agentId: uuid("agent_id").references(() => agents.id),
    initiatedBy: text("initiated_by").notNull().default("system"),
    operationType: text("operation_type").notNull(), // install, update, uninstall, policy_change, enrollment, etc.
    packageId: text("package_id").notNull().default(""),
    manager: text("manager").notNull().default(""),
    version: text("version").notNull().default(""),
    status: text("status").notNull().default("pending"), // pending, running, completed, failed, cancelled
    logText: text("log_text").notNull().default(""),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_audit_log_agent_id").on(table.agentId),
    index("idx_audit_log_logged_at").on(table.loggedAt),
  ]
);

export const policies = pgTable("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(), // source_allowlist, package_blocklist, hash_policy, command_allowlist, approval_criteria
  configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
