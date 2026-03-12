-- Table: public.summaries_websites

-- DROP TABLE IF EXISTS public.summaries_websites;

CREATE TABLE IF NOT EXISTS public.summaries_websites
(
    id integer NOT NULL DEFAULT nextval('summaries_websites_id_seq'::regclass),
    platform text COLLATE pg_catalog."default" NOT NULL DEFAULT 'Websites'::text,
    url text COLLATE pg_catalog."default" NOT NULL,
    main_url text COLLATE pg_catalog."default" NOT NULL,
    title text COLLATE pg_catalog."default",
    type text COLLATE pg_catalog."default",
    status text COLLATE pg_catalog."default" NOT NULL DEFAULT 'NEW'::text,
    description text COLLATE pg_catalog."default",
    tldr text COLLATE pg_catalog."default",
    tags jsonb,
    summary jsonb,
    actionable_takeaways jsonb,
    notes jsonb,
    confidence text COLLATE pg_catalog."default",
    cover text COLLATE pg_catalog."default",
    key_insights jsonb,
    other1 text COLLATE pg_catalog."default",
    other2 text COLLATE pg_catalog."default",
    other3 text COLLATE pg_catalog."default",
    addedby text COLLATE pg_catalog."default" NOT NULL DEFAULT 'admin'::text,
    date_created timestamp with time zone DEFAULT now(),
    date_update timestamp with time zone DEFAULT now(),
    CONSTRAINT summaries_websites_pkey PRIMARY KEY (id),
    CONSTRAINT summaries_websites_url_key UNIQUE (url),
    CONSTRAINT summaries_websites_status_check CHECK (status = ANY (ARRAY['NEW'::text, 'PENDING'::text, 'DONE'::text, 'FAILED'::text]))
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.summaries_websites
    OWNER to admin;

-- Index: idx_summaries_websites_main_url

-- DROP INDEX IF EXISTS public.idx_summaries_websites_main_url;

CREATE INDEX IF NOT EXISTS idx_summaries_websites_main_url
    ON public.summaries_websites USING btree
    (main_url COLLATE pg_catalog."default" ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

-- Trigger: update_summaries_websites_updated_at

-- DROP TRIGGER IF EXISTS update_summaries_websites_updated_at ON public.summaries_websites;

CREATE OR REPLACE TRIGGER update_summaries_websites_updated_at
    BEFORE UPDATE 
    ON public.summaries_websites
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();


-- Table: public.summaries

-- DROP TABLE IF EXISTS public.summaries;

CREATE TABLE IF NOT EXISTS public.summaries
(
    videoid text COLLATE pg_catalog."default" NOT NULL,
    status text COLLATE pg_catalog."default",
    channel text COLLATE pg_catalog."default",
    name text COLLATE pg_catalog."default",
    description text COLLATE pg_catalog."default",
    summary text COLLATE pg_catalog."default",
    tags text COLLATE pg_catalog."default",
    actionable_takeaways text COLLATE pg_catalog."default",
    notes text COLLATE pg_catalog."default",
    confidence text COLLATE pg_catalog."default",
    cover text COLLATE pg_catalog."default",
    tldr text COLLATE pg_catalog."default",
    key_insights text COLLATE pg_catalog."default",
    other2 text COLLATE pg_catalog."default",
    other3 text COLLATE pg_catalog."default",
    date_created timestamp with time zone NOT NULL DEFAULT now(),
    date_update timestamp with time zone,
    url text COLLATE pg_catalog."default",
    addedby text COLLATE pg_catalog."default" NOT NULL DEFAULT 'admin'::text,
    CONSTRAINT summaries_pkey PRIMARY KEY (videoid)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.summaries
    OWNER to admin;

-- Index: idx_summaries_tldr

CREATE INDEX IF NOT EXISTS idx_summaries_tldr
    ON public.summaries USING btree
    (tldr COLLATE pg_catalog."default" ASC NULLS LAST)
    TABLESPACE pg_default;

-- Table: public.import

-- DROP TABLE IF EXISTS public.import;

CREATE TABLE IF NOT EXISTS public.import
(
    platform text COLLATE pg_catalog."default",
    url text COLLATE pg_catalog."default",
    videoid text COLLATE pg_catalog."default" NOT NULL,
    title text COLLATE pg_catalog."default",
    channel text COLLATE pg_catalog."default",
    description text COLLATE pg_catalog."default",
    subtitles text COLLATE pg_catalog."default",
    auto_captions text COLLATE pg_catalog."default",
    date_import timestamp with time zone NOT NULL DEFAULT now(),
    date_update timestamp with time zone,
    tags text COLLATE pg_catalog."default",
    other1 text COLLATE pg_catalog."default",
    other2 text COLLATE pg_catalog."default",
    other3 text COLLATE pg_catalog."default",
    other4 text COLLATE pg_catalog."default",
    status text COLLATE pg_catalog."default",
    transcript_normalized text COLLATE pg_catalog."default",
    addedby text COLLATE pg_catalog."default" NOT NULL DEFAULT 'admin'::text,
    CONSTRAINT import_pkey PRIMARY KEY (videoid)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.import
    OWNER to admin;

-- Table: public.config

-- DROP TABLE IF EXISTS public.config;

CREATE TABLE IF NOT EXISTS public.config
(
    id integer NOT NULL DEFAULT nextval('config_id_seq'::regclass),
    key character varying(255) COLLATE pg_catalog."default" NOT NULL,
    value text COLLATE pg_catalog."default",
    description text COLLATE pg_catalog."default",
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    date_updated timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT config_pkey PRIMARY KEY (id),
    CONSTRAINT config_key_key UNIQUE (key)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.config
    OWNER to admin;

-- Index: idx_config_key

-- DROP INDEX IF EXISTS public.idx_config_key;

CREATE INDEX IF NOT EXISTS idx_config_key
    ON public.config USING btree
    (key COLLATE pg_catalog."default" ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

-- Table: public.import_custom

-- DROP TABLE IF EXISTS public.import_custom;

CREATE TABLE IF NOT EXISTS public.import_custom
(
    id integer NOT NULL DEFAULT nextval('import_custom_id_seq'::regclass),
    title text COLLATE pg_catalog."default" NOT NULL,
    source text COLLATE pg_catalog."default" NOT NULL,
    content text COLLATE pg_catalog."default" NOT NULL,
    status text COLLATE pg_catalog."default" NOT NULL DEFAULT 'NEW'::text,
    created_at timestamp with time zone DEFAULT now(),
    date_update timestamp with time zone DEFAULT now(),
    other1 text COLLATE pg_catalog."default",
    other2 text COLLATE pg_catalog."default",
    other3 text COLLATE pg_catalog."default",
    type text COLLATE pg_catalog."default" DEFAULT 'custom'::text,
    addedby text COLLATE pg_catalog."default" NOT NULL DEFAULT 'admin'::text,
    CONSTRAINT import_custom_pkey PRIMARY KEY (id),
    CONSTRAINT import_custom_status_check CHECK (status = ANY (ARRAY['NEW'::text, 'PENDING'::text, 'DONE'::text, 'FAILED'::text])),
    CONSTRAINT import_custom_type_check CHECK (type IS NULL OR (type = ANY (ARRAY['custom'::text, 'url'::text])))
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.import_custom
    OWNER to admin;

-- Index: idx_import_custom_status

-- DROP INDEX IF EXISTS public.idx_import_custom_status;

CREATE INDEX IF NOT EXISTS idx_import_custom_status
    ON public.import_custom USING btree
    (status COLLATE pg_catalog."default" ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

-- Index: idx_import_custom_type

-- DROP INDEX IF EXISTS public.idx_import_custom_type;

CREATE INDEX IF NOT EXISTS idx_import_custom_type
    ON public.import_custom USING btree
    (type COLLATE pg_catalog."default" ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

-- Trigger: update_import_custom_date_update

-- DROP TRIGGER IF EXISTS update_import_custom_date_update ON public.import_custom;

CREATE OR REPLACE TRIGGER update_import_custom_date_update
    BEFORE UPDATE 
    ON public.import_custom
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Table: public.summaries_custom

-- DROP TABLE IF EXISTS public.summaries_custom;

CREATE TABLE IF NOT EXISTS public.summaries_custom
(
    id integer NOT NULL DEFAULT nextval('summaries_custom_id_seq'::regclass),
    title text COLLATE pg_catalog."default" NOT NULL,
    content text COLLATE pg_catalog."default",
    status text COLLATE pg_catalog."default" NOT NULL DEFAULT 'NEW'::text,
    description text COLLATE pg_catalog."default",
    tldr text COLLATE pg_catalog."default",
    summary jsonb,
    key_insights jsonb,
    actionable_takeaways jsonb,
    notes jsonb,
    confidence text COLLATE pg_catalog."default",
    tags jsonb,
    date_created timestamp with time zone DEFAULT now(),
    date_update timestamp with time zone DEFAULT now(),
    import_id INTEGER REFERENCES import_custom(id),
    other1 text COLLATE pg_catalog."default",
    other2 text COLLATE pg_catalog."default",
    other3 text COLLATE pg_catalog."default",
    addedby text COLLATE pg_catalog."default" NOT NULL DEFAULT 'admin'::text,
    CONSTRAINT summaries_custom_pkey PRIMARY KEY (id),
    CONSTRAINT summaries_custom_status_check CHECK (status = ANY (ARRAY['NEW'::text, 'PENDING'::text, 'DONE'::text, 'FAILED'::text]))
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.summaries_custom
    OWNER to admin;

-- Index: idx_summaries_custom_status

-- DROP INDEX IF EXISTS public.idx_summaries_custom_status;

CREATE INDEX IF NOT EXISTS idx_summaries_custom_status
    ON public.summaries_custom USING btree
    (status COLLATE pg_catalog."default" ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

-- Trigger: update_summaries_custom_updated_at

-- DROP TRIGGER IF EXISTS update_summaries_custom_updated_at ON public.summaries_custom;

CREATE OR REPLACE TRIGGER update_summaries_custom_updated_at
    BEFORE UPDATE 
    ON public.summaries_custom
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- CRITICAL: Update trigger function definition FIRST
-- This function must be created before any triggers that reference it

-- Trigger function for automatic updated_at column management
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.date_update = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions (FIXED: Use 'admin' instead of 'postgres')
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO admin;

-- OIDC Authentication Tables

-- Users table for OIDC-only authentication
CREATE TABLE IF NOT EXISTS public.users
(
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    role VARCHAR(50) DEFAULT 'user',
    oidc_provider VARCHAR(50),
    oidc_subject VARCHAR(255),
    oidc_email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sessions table for OIDC session management with security columns
CREATE TABLE IF NOT EXISTS public.sessions
(
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    nonce VARCHAR(255),
    state VARCHAR(255),
    code_verifier VARCHAR(255)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_oidc_subject ON public.users(oidc_subject);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_token ON public.sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON public.sessions(expires_at);

-- OIDC Security Indexes (PKCE, State, Nonce)
CREATE INDEX IF NOT EXISTS idx_sessions_nonce ON public.sessions(nonce) WHERE nonce IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_state ON public.sessions(state) WHERE state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_code_verifier ON public.sessions(code_verifier) WHERE code_verifier IS NOT NULL;

-- Column comments for OIDC security documentation
COMMENT ON COLUMN public.sessions.nonce IS 'OIDC nonce parameter for ID token replay attack prevention';
COMMENT ON COLUMN public.sessions.state IS 'OIDC state parameter for CSRF attack prevention';
COMMENT ON COLUMN public.sessions.code_verifier IS 'PKCE code verifier for authorization code flow security';
COMMENT ON COLUMN public.users.oidc_provider IS 'OIDC provider identifier (e.g., auth.example.com)';
COMMENT ON COLUMN public.users.oidc_subject IS 'OIDC subject identifier - unique identifier from provider';
COMMENT ON COLUMN public.users.oidc_email IS 'Email address from OIDC provider';

-- Favorites table for user-saved summaries
CREATE TABLE IF NOT EXISTS public.favorites (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    summary_id VARCHAR(255) NOT NULL,
    source_type VARCHAR(20) NOT NULL,
    date_created TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT favorites_username_summary_id_source_type_key UNIQUE (username, summary_id, source_type)
);

-- Indexes for favorites
CREATE INDEX IF NOT EXISTS idx_favorites_username ON public.favorites(username);
CREATE INDEX IF NOT EXISTS idx_favorites_summary ON public.favorites(summary_id);

-- Trigger function for users table (handles updated_at column)
CREATE OR REPLACE FUNCTION public.update_users_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions (FIXED: Use 'admin' instead of 'postgres')
GRANT EXECUTE ON FUNCTION public.update_users_updated_at_column() TO admin;

-- Add unique constraint for OIDC subject (required for ON CONFLICT)
ALTER TABLE IF EXISTS public.users 
    ADD CONSTRAINT users_oidc_subject_unique UNIQUE (oidc_subject);

-- Trigger for users table updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE 
    ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.update_users_updated_at_column();


-- Create chat prompts table for arena.html
CREATE TABLE IF NOT EXISTS public.chat_prompts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    prompt_text TEXT NOT NULL,
    category VARCHAR(100) DEFAULT 'General',
    is_active BOOLEAN DEFAULT true,
    date_created TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add some default prompts
INSERT INTO public.chat_prompts (title, prompt_text, category) VALUES 
('General Summary', 'Provide a comprehensive summary of the key points from all selected content.', 'General'),
('Key Insights', 'What are the most important insights or takeaways from this content?', 'Analysis'),
('Compare and Contrast', 'Compare and contrast the main themes across these different sources.', 'Comparison'),
('Action Items', 'What specific actions or recommendations can be derived from this content?', 'Practical'),
('Technical Details', 'Explain the technical concepts and terminology used in this content.', 'Technical')
ON CONFLICT DO NOTHING;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_prompts_category ON public.chat_prompts(category);
CREATE INDEX IF NOT EXISTS idx_chat_prompts_active ON public.chat_prompts(is_active);

-- YouTube Playlists table for playlist tracking
CREATE TABLE IF NOT EXISTS public.youtube_playlists (
    id SERIAL PRIMARY KEY,
    user_username VARCHAR(255) NOT NULL UNIQUE,
    playlist_url TEXT NOT NULL,
    playlist_id VARCHAR(255) NOT NULL,
    playlist_title TEXT,
    video_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    last_checked_at TIMESTAMP WITH TIME ZONE,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT youtube_playlists_user_username_key UNIQUE (user_username),
    CONSTRAINT youtube_playlists_status_check CHECK (status IN ('active', 'paused', 'error'))
);

-- Indexes for youtube_playlists
CREATE INDEX IF NOT EXISTS idx_youtube_playlists_user ON public.youtube_playlists(user_username);
CREATE INDEX IF NOT EXISTS idx_youtube_playlists_status ON public.youtube_playlists(status);

-- Trigger function for youtube_playlists table
CREATE OR REPLACE FUNCTION public.update_youtube_playlists_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.update_youtube_playlists_updated_at() TO admin;

-- Trigger for youtube_playlists updated_at
CREATE TRIGGER update_youtube_playlists_updated_at
    BEFORE UPDATE
    ON public.youtube_playlists
    FOR EACH ROW
    EXECUTE FUNCTION public.update_youtube_playlists_updated_at();

-- Configuration for Chat AI (NEW)
INSERT INTO public.config (key, value, description, date_updated) VALUES 
('chat_openai_api_url', 'https://api.openai.com/v1/chat/completions', 'API URL for chat operations', NOW()),
('chat_openai_model', 'gpt-4o-mini', 'Model name for chat operations', NOW()),
('chat_openai_system_prompt', 'You are a helpful assistant that answers questions about provided YouTube video transcripts. Base your answers strictly on transcript. Format your responses using markdown for better readability with headers, lists, and emphasis where appropriate. Be concise and keep your responses short.', 'System prompt for chat operations', NOW()),
('chat_openai_api_key', '', 'API key for chat operations (optional - can use environment variable)', NOW())
ON CONFLICT (key) DO NOTHING;

-- Configuration for Summarizing AI (NEW)
INSERT INTO public.config (key, value, description, date_updated) VALUES 
('summary_openai_api_url', 'https://api.openai.com/v1/chat/completions', 'API URL for summarizing operations', NOW()),
('summary_openai_model', 'gpt-4o-mini', 'Model name for summarizing operations', NOW()),
('summary_openai_api_key', '', 'API key for summarizing operations (optional - can use environment variable)', NOW())
ON CONFLICT (key) DO NOTHING;

-- Chat Enhancement Configuration (NEW)
INSERT INTO public.config (key, value, description, date_updated) VALUES 
('chat_stream_with_reasoning', 'true', 'Enable streaming responses with reasoning extraction', NOW()),
('chat_include_metrics', 'true', 'Include token metrics in chat responses', NOW()),
('chat_debug_reasoning', 'false', 'Enable debug logging for reasoning parsing', NOW()),
('chat_reasoning_format', 'deepseek', 'Format for reasoning extraction (deepseek, deepseek-legacy, none)', NOW())
ON CONFLICT (key) DO NOTHING;




INSERT INTO public.config (key, value, description, date_updated) VALUES 
('webllm_system_prompt', 'TEXT', 'enable_thinking=false  You are a helpful assistant that answers questions about provided YouTube video transcripts. Base your answers strictly on transcript. Format your responses using markdown for better readability with headers, lists, and emphasis where appropriate. Be concise and keep your responses short.', NOW());

-- YouTube Transcript Provider Configuration (NEW)
INSERT INTO public.config (key, value, description, date_updated) VALUES
('youtube_transcript_provider_type', 'ytdlp', 'YouTube transcript provider type: ytdlp (Docker container) or langchain (YouTube API)', NOW()),
('langchain_chunk_size_seconds', '30', 'Chunk size in seconds for LangChain YouTube transcript fetching', NOW()),
('langchain_transcript_language', 'en_auto', 'Language preference for LangChain YouTube transcript extraction: en (English only), en_auto (auto-detect with English fallback), or any ISO 639-1 code', NOW()),
('yt_dlp_item_delay_seconds', '120', 'Delay in seconds between individual YouTube video transcript requests to prevent API blocking. Recommended: 120-180 seconds for cloud provider IPs.', NOW()),
('yt_dlp_failed_job_retry_hours', '24', 'Hours to wait before automatically retrying failed import jobs. Set to 0 to disable retry feature. Max 168 (7 days).', NOW())
ON CONFLICT (key) DO NOTHING;

-- Failover Configuration for Summarizing AI (NEW)
INSERT INTO public.config (key, value, description, date_updated) VALUES
('summary_openai_failover_enabled', 'true', 'Enable automatic failover to secondary endpoint on primary failure', NOW()),
('summary_openai_failover_mode', 'failover', 'Failover mode: failover (primary to secondary), primary_only, secondary_only', NOW()),
('summary_openai_failover_timeout_seconds', '60', 'Timeout in seconds before failing over to secondary endpoint (1-300 seconds)', NOW()),
('summary_openai_secondary_api_url', '', 'Secondary OpenAI API endpoint URL for failover', NOW()),
('summary_openai_secondary_api_key', '', 'Secondary OpenAI API key (optional - uses primary if empty)', NOW()),
('summary_openai_secondary_model', '', 'Secondary OpenAI model name (required when using secondary endpoint)', NOW())
ON CONFLICT (key) DO NOTHING;

-- Security Configuration (NEW)
INSERT INTO public.config (key, value, description, date_updated) VALUES
('rate_limit_max', '1000', 'Maximum requests per 15 minutes per IP for API rate limiting (100-10000)', NOW())
ON CONFLICT (key) DO NOTHING;


-- ============================================================================
-- AUDIT LOG TABLE (Security & Compliance)
-- ============================================================================
-- Created: 2026-03-05
-- Purpose: Audit trail for all critical operations in the system
--
-- Integration: Used by backend/auth/shared/index.js logAuditEvent() function
--
-- Coverage: 29+ audit logging points across all route files:
--   - favorites.js: 3 points (POST /, DELETE /, GET /)
--   - playlist.js: 4 points (POST /, DELETE /, PUT /status, GET /)
--   - grabCustom.js: 2 points (POST /, GET /)
--   - adminPages.js: 4 points (POST /, PUT /:id, DELETE /:id, GET /)
--   - summaries.js: 5 points (POST /, PUT /:id, DELETE /:id, PATCH /:id/status, GET /)
--   - summariesCustom.js: 2 points (POST /, PUT /:id)
--   - import.js: 3 points (POST /, PUT /:id, DELETE /:id)
--   - adminConfig.js: 4 points (POST /, PUT /:key, DELETE /:key, PATCH /)
--   - adminUploadRoutes.js: 2 points (POST /, DELETE /:id)
--
-- Verification Queries:
--   SELECT COUNT(*) FROM audit_log;                                    -- Total entries
--   SELECT action, COUNT(*) FROM audit_log GROUP BY action;           -- Actions by type
--   SELECT resource_type, COUNT(*) FROM audit_log GROUP BY resource_type; -- Resources by type
--   SELECT username, COUNT(*) FROM audit_log GROUP BY username ORDER BY count DESC; -- Activity by user
--   SELECT * FROM audit_log WHERE success = false ORDER BY timestamp DESC LIMIT 20; -- Recent failures
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    action VARCHAR(50) NOT NULL,           -- CREATE, READ, UPDATE, DELETE, UPLOAD, LOGIN, LOGOUT
    resource_type VARCHAR(100) NOT NULL,   -- summaries, users, config, favorites, playlists, etc.
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
CREATE INDEX IF NOT EXISTS idx_audit_log_success ON public.audit_log(success);
CREATE INDEX IF NOT EXISTS idx_audit_log_gin_details ON public.audit_log USING GIN (details);

-- Comments for documentation
COMMENT ON TABLE public.audit_log IS 'Audit trail for all critical operations in the system - tracks CREATE, READ, UPDATE, DELETE actions on all resources';
COMMENT ON COLUMN public.audit_log.action IS 'Action type: CREATE, READ, UPDATE, DELETE, UPLOAD, LOGIN, LOGOUT, etc.';
COMMENT ON COLUMN public.audit_log.resource_type IS 'Resource type: summaries, users, config, favorites, playlists, prompts, etc.';
COMMENT ON COLUMN public.audit_log.resource_id IS 'ID of the affected resource (videoid, summary ID, config key, etc.)';
COMMENT ON COLUMN public.audit_log.details IS 'JSONB field for flexible context storage (request body, changes, etc.)';
COMMENT ON COLUMN public.audit_log.ip_address IS 'Client IP address from request';
COMMENT ON COLUMN public.audit_log.user_agent IS 'Browser/client identifier from request';
COMMENT ON COLUMN public.audit_log.success IS 'Whether the operation succeeded (false for errors/failed attempts)';
COMMENT ON COLUMN public.audit_log.error_message IS 'Error message if operation failed';

-- Optional: Partitioning for high-volume systems (uncomment if needed)
-- CREATE TABLE audit_log_y2026m03 PARTITION OF audit_log
--     FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
-- CREATE TABLE audit_log_y2026m04 PARTITION OF audit_log
--     FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- Optional: Retention policy (delete logs older than 1 year)
-- Uncomment and execute separately if you want automatic cleanup:
--
-- CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
-- RETURNS void AS $$
-- BEGIN
--     DELETE FROM public.audit_log
--     WHERE timestamp < NOW() - INTERVAL '1 year';
--     RAISE NOTICE 'Deleted % old audit log entries', (ROW_COUNT);
-- END;
-- $$ LANGUAGE plpgsql;
--
-- -- Then create a cron job or pg_cron extension to run it periodically
-- SELECT cron.schedule('cleanup-audit-logs', '0 2 * * *', 'SELECT cleanup_old_audit_logs()');
--
-- -- Or run manually:
-- SELECT cleanup_old_audit_logs();

-- Grant permissions
GRANT SELECT, INSERT ON public.audit_log TO admin;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO admin;

-- ============================================================================
-- EXTERNAL TABLE: connect_pg_sessions
-- ============================================================================
-- The connect_pg_sessions table is managed by the connect-pg-simple library
-- (or similar PostgreSQL session store). It is created automatically by the
-- library and should not be manually modified or included in this schema file.
--
-- Table Structure (for reference):
--   - sid: VARCHAR(255) PRIMARY KEY (session ID)
--   - sess: JSON (session data)
--   - expire: TIMESTAMP WITH TIME ZONE (expiration time)
--
-- Indexes:
--   - connect_pg_sessions_pkey (PRIMARY KEY on sid)
--   - idx_connect_pg_sessions_expire (on expire column)
--
-- Reference: https://github.com/doug-martin/node-connect-pg-simple
-- ============================================================================
