-- Audit log immutability enforcement
-- Run after initial schema migration

-- 1. Create a dedicated low-privilege role for audit writes
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_writer') THEN
    CREATE ROLE audit_writer;
  END IF;
END
$$;

GRANT INSERT, SELECT ON audit_log TO audit_writer;
REVOKE UPDATE, DELETE ON audit_log FROM audit_writer;

-- 2. Trigger-based hard block (defense-in-depth)
CREATE OR REPLACE FUNCTION audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable — UPDATE and DELETE are not permitted';
END;
$$;

DROP TRIGGER IF EXISTS enforce_audit_immutable ON audit_log;
CREATE TRIGGER enforce_audit_immutable
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_immutable();
