-- Audit log table for tracking all critical operations
-- References: backend/auth/shared/index.js logAuditEvent function
--
-- Execute this manually against your database:
-- PGPASSWORD='your-password' psql -h postgres -p 5432 -U llm -d summaries -f backend/schema/audit_log.sql

CREATE TABLE IF NOT EXISTS public.audit_log (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    action VARCHAR(50) NOT NULL,           -- CREATE, READ, UPDATE, DELETE
    resource_type VARCHAR(100) NOT NULL,   -- summaries, users, config, etc.
    resource_id VARCHAR(255),              -- ID of affected resource
    details JSONB,                         -- Additional context (flexible schema)
    user_id INTEGER REFERENCES public.users(id),
    username VARCHAR(255),
    user_role VARCHAR(50),
    ip_address INET,
    user_agent TEXT,
    session_id VARCHAR(255),
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON public.audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON public.audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_gin_details ON public.audit_log USING GIN (details);

-- Comments for documentation
COMMENT ON TABLE public.audit_log IS 'Audit trail for all critical operations in the system';
COMMENT ON COLUMN public.audit_log.details IS 'JSONB field for flexible context storage';
COMMENT ON COLUMN public.audit_log.ip_address IS 'Client IP address from request';
COMMENT ON COLUMN public.audit_log.user_agent IS 'Browser/client identifier from request';

-- Optional: Partitioning for high-volume systems (uncomment if needed)
-- CREATE TABLE audit_log_y2026m03 PARTITION OF audit_log
--     FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- Optional: Retention policy (delete logs older than 1 year)
-- Uncomment and execute separately if you want automatic cleanup:
--
-- CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
-- RETURNS void AS $$
-- BEGIN
--     DELETE FROM public.audit_log
--     WHERE timestamp < NOW() - INTERVAL '1 year';
-- END;
-- $$ LANGUAGE plpgsql;
--
-- -- Then create a cron job or pg_cron extension to run it periodically
-- SELECT cron.schedule('cleanup-audit-logs', '0 2 * * *', 'SELECT cleanup_old_audit_logs()');
