-- audit_findings 테이블, v_external_email_risks 뷰, v_gdb_nodes 외부 수신자 구분

-- 1. audit_findings 테이블
CREATE TABLE IF NOT EXISTS audit_findings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_source_id  UUID NOT NULL REFERENCES evidence_sources(id),
    source_file_id      UUID REFERENCES files(id) ON DELETE SET NULL,
    finding_type        TEXT NOT NULL,
    severity            TEXT NOT NULL CHECK (severity IN ('high','medium','low')),
    actor               TEXT,
    description         TEXT NOT NULL,
    evidence_detail     JSONB,
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed            BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_audit_findings_type     ON audit_findings(finding_type);
CREATE INDEX IF NOT EXISTS idx_audit_findings_severity ON audit_findings(severity);
CREATE INDEX IF NOT EXISTS idx_audit_findings_actor    ON audit_findings(actor);

-- 2. v_external_email_risks 뷰
CREATE OR REPLACE VIEW v_external_email_risks AS
SELECT
    em.id               AS email_id,
    em.sender,
    em.subject,
    em.sent_at,
    em.has_attachments,
    em.recipients_to,
    f.original_path     AS source_pst,
    CASE
        WHEN em.recipients_to::text ILIKE '%protonmail%'
          OR em.recipients_to::text ILIKE '%tutanota%'
          OR em.recipients_to::text ILIKE '%guerrillamail%'
        THEN 'high'
        WHEN em.has_attachments = true THEN 'medium'
        ELSE 'low'
    END AS risk_level
FROM email_messages em
JOIN files f ON f.id = em.source_file_id
WHERE em.sender ILIKE '%hb.%'
  AND em.recipients_to IS NOT NULL
  AND em.recipients_to != '[]'::jsonb
  AND em.recipients_to::text NOT ILIKE '%hb.%'
  AND em.recipients_to::text NOT ILIKE '%noreply%'
  AND em.recipients_to::text NOT ILIKE '%undisclosed%';

-- 3. v_gdb_nodes 재생성 — 외부 수신자를 external_recipient node_type으로 구분
CREATE OR REPLACE VIEW v_gdb_nodes AS

SELECT 'user:' || id::text          AS node_id,
       'user'                        AS node_type,
       name                          AS label,
       jsonb_build_object('role', role, 'username', system_username) AS properties
FROM users

UNION ALL

SELECT 'file:' || id::text,
       'file',
       filename,
       jsonb_build_object('category', category, 'path', relative_path,
                          'size', file_size, 'ext', extension)
FROM files
WHERE is_user_content = TRUE

UNION ALL

SELECT 'entity:' || id::text,
       entity_type::text,
       canonical_value,
       jsonb_build_object('aliases', aliases)
FROM entity_canonical

UNION ALL

SELECT 'event:' || id::text,
       'event',
       event_type || ': ' || COALESCE(target_path, url, process_name, ''),
       jsonb_build_object('event_at', event_at, 'actor', actor)
FROM activity_events

UNION ALL

SELECT 'emailmsg:' || id::text,
       'email',
       COALESCE(subject, '(제목없음)'),
       jsonb_build_object('sender', sender, 'sent_at', sent_at)
FROM email_messages

UNION ALL

-- 내부 발신자/수신자 (hb.* 도메인)
SELECT DISTINCT
       'email:' || lower(sender)    AS node_id,
       'email_identity'             AS node_type,
       lower(sender)                AS label,
       jsonb_build_object('source', 'sender', 'is_internal', true) AS properties
FROM email_messages
WHERE sender IS NOT NULL

UNION ALL

SELECT DISTINCT
       'email:' || lower(r.recipient) AS node_id,
       'email_identity'               AS node_type,
       lower(r.recipient)             AS label,
       jsonb_build_object('source', 'recipient', 'is_internal', true) AS properties
FROM email_messages em,
LATERAL jsonb_array_elements_text(COALESCE(em.recipients_to, '[]'::jsonb)) AS r(recipient)
WHERE r.recipient IS NOT NULL
  AND r.recipient ILIKE '%hb.%'

UNION ALL

-- 외부 수신자 (hb.* 아닌 모든 수신자)
SELECT DISTINCT
       'email:' || lower(r.recipient) AS node_id,
       'external_recipient'           AS node_type,
       lower(r.recipient)             AS label,
       jsonb_build_object('source', 'recipient', 'is_internal', false) AS properties
FROM email_messages em,
LATERAL jsonb_array_elements_text(COALESCE(em.recipients_to, '[]'::jsonb)) AS r(recipient)
WHERE r.recipient IS NOT NULL
  AND r.recipient NOT ILIKE '%hb.%'
  AND r.recipient NOT ILIKE '%noreply%'
  AND r.recipient NOT ILIKE '%undisclosed%'
  AND r.recipient NOT ILIKE '%@%@%';
