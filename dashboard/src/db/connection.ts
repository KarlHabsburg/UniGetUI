import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://unigetui:unigetui@localhost:5432/unigetui";

const client = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export { client };
