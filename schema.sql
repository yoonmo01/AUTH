-- HYENA CTF — PostgreSQL 16 Schema (v4)
-- 실행: python init_db.py  또는  psql -U hyena -d hyena -f schema.sql

-- ============================================================
-- EXTENSIONS & ENUMS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE file_category AS ENUM (
    'document', 'image', 'audio',
    'email_store', 'archive', 'system_artifact', 'unknown'
);

CREATE TYPE etl_status_type AS ENUM (
    'pending', 'processing', 'done', 'failed', 'skipped'
);

CREATE TYPE entity_kind AS ENUM (
    'person', 'organization', 'product', 'location',
    'date', 'amount', 'contact', 'document_ref', 'other'
);

CREATE TYPE relation_kind AS ENUM (
    'duplicate', 'similar_content', 'referenced_by',
    'derived_from', 'co_located', 'same_sender', 'format_variant'
);


-- ============================================================
-- CORE LAYER
-- ============================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(50)  NOT NULL,
    role            VARCHAR(20),
    system_username VARCHAR(100),
    email           VARCHAR(200),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE evidence_sources (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id),
    source_label            TEXT NOT NULL,
    source_type             TEXT NOT NULL,
    drive_root_path         TEXT NOT NULL,
    acquisition_started_at  TIMESTAMPTZ,
    acquisition_ended_at    TIMESTAMPTZ,
    notes                   TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE directories (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_source_id  UUID NOT NULL REFERENCES evidence_sources(id) ON DELETE CASCADE,
    parent_id           UUID REFERENCES directories(id),
    full_path           TEXT NOT NULL,
    name                TEXT NOT NULL,
    depth               INT  DEFAULT 0,
    UNIQUE (evidence_source_id, full_path)
);

CREATE INDEX idx_dir_source  ON directories(evidence_source_id);
CREATE INDEX idx_dir_parent  ON directories(parent_id);

CREATE TABLE files (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_source_id  UUID NOT NULL REFERENCES evidence_sources(id),
    directory_id        UUID REFERENCES directories(id),

    filename            TEXT NOT NULL,
    extension           VARCHAR(20),
    mime_type           TEXT,
    original_path       TEXT NOT NULL,
    relative_path       TEXT NOT NULL,

    storage_uri         TEXT,

    file_size           BIGINT,
    sha256_hash         VARCHAR(64),
    md5_hash            VARCHAR(32),

    file_modified_at    TIMESTAMPTZ,
    file_accessed_at    TIMESTAMPTZ,
    file_created_at     TIMESTAMPTZ,
    file_changed_at     TIMESTAMPTZ,

    is_system_path      BOOLEAN DEFAULT FALSE,
    is_user_content     BOOLEAN DEFAULT FALSE,

    category            file_category DEFAULT 'unknown',
    etl_status          etl_status_type DEFAULT 'pending',
    etl_error           TEXT,
    etl_processed_at    TIMESTAMPTZ,

    indexed_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (evidence_source_id, relative_path)
);

CREATE INDEX idx_files_source       ON files(evidence_source_id);
CREATE INDEX idx_files_category     ON files(category);
CREATE INDEX idx_files_etl          ON files(etl_status);
CREATE INDEX idx_files_ext          ON files(extension);
CREATE INDEX idx_files_sha256       ON files(sha256_hash);
CREATE INDEX idx_files_modified     ON files(file_modified_at);
CREATE INDEX idx_files_user_content ON files(is_user_content) WHERE is_user_content = TRUE;


-- ============================================================
-- ETL RESULT LAYER
-- ============================================================

CREATE TABLE documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id             UUID NOT NULL REFERENCES files(id) UNIQUE,
    doc_type            VARCHAR(20),
    page_count          INT,
    sheet_count         INT,
    has_embedded_images BOOLEAN DEFAULT FALSE,
    detected_language   VARCHAR(10),
    processor_name      TEXT,
    processor_version   TEXT,
    extraction_error    TEXT,
    extracted_at        TIMESTAMPTZ
);

CREATE TABLE images (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id             UUID NOT NULL REFERENCES files(id) UNIQUE,
    width               INT,
    height              INT,
    color_mode          VARCHAR(20),
    is_screenshot       BOOLEAN,
    is_document_scan    BOOLEAN,
    vision_description  TEXT,
    model_name          VARCHAR(100) DEFAULT 'gpt-4o',
    prompt_version      TEXT,
    vision_tags         JSONB,
    vision_processed_at TIMESTAMPTZ,
    vision_error        TEXT
);

CREATE TABLE audios (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id             UUID NOT NULL REFERENCES files(id) UNIQUE,
    duration_seconds    FLOAT,
    sample_rate         INT,
    channels            INT,
    stt_provider        TEXT,
    model_name          TEXT,
    prompt_version      TEXT,
    provider_job_id     TEXT,
    stt_language        VARCHAR(10),
    stt_confidence      FLOAT CHECK (stt_confidence BETWEEN 0 AND 1),
    stt_processed_at    TIMESTAMPTZ,
    stt_error           TEXT
);

CREATE TABLE artifacts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id             UUID NOT NULL REFERENCES files(id) UNIQUE,
    artifact_type       TEXT,
    total_contained     INT,
    contained_files     JSONB,
    parse_method        TEXT,
    parse_error         TEXT,
    parsed_at           TIMESTAMPTZ
);

CREATE TABLE email_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file_id      UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    message_id          TEXT NOT NULL,
    subject             TEXT,
    sender              TEXT,
    recipients_to       JSONB CHECK (recipients_to IS NULL OR jsonb_typeof(recipients_to) = 'array'),
    recipients_cc       JSONB CHECK (recipients_cc IS NULL OR jsonb_typeof(recipients_cc) = 'array'),
    sent_at             TIMESTAMPTZ,
    received_at         TIMESTAMPTZ,
    folder_path         TEXT,
    body_text           TEXT,
    has_attachments     BOOLEAN DEFAULT FALSE,
    metadata            JSONB,
    UNIQUE (source_file_id, message_id)
);

CREATE INDEX idx_email_source  ON email_messages(source_file_id);
CREATE INDEX idx_email_sent    ON email_messages(sent_at);
CREATE INDEX idx_email_sender  ON email_messages(sender);

CREATE TABLE email_attachments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id            UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    file_id             UUID REFERENCES files(id) ON DELETE SET NULL,
    attachment_name     TEXT,
    content_type        TEXT,
    size_bytes          BIGINT,
    sha256_hash         VARCHAR(64),
    extracted_path      TEXT,
    metadata            JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_eattach_email ON email_attachments(email_id);
CREATE INDEX idx_eattach_file  ON email_attachments(file_id);
CREATE UNIQUE INDEX idx_eattach_unique
ON email_attachments(email_id, attachment_name, size_bytes, sha256_hash);

CREATE TABLE activity_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file_id      UUID REFERENCES files(id) ON DELETE SET NULL,
    evidence_source_id  UUID NOT NULL REFERENCES evidence_sources(id),
    event_type          TEXT NOT NULL,
    event_at            TIMESTAMPTZ,
    actor               TEXT,
    process_name        TEXT,
    executable_path     TEXT,
    target_path         TEXT,
    url                 TEXT,
    title               TEXT,
    run_count           INT,
    confidence          FLOAT DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
    metadata            JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_source ON activity_events(evidence_source_id);
CREATE INDEX idx_activity_time   ON activity_events(event_at);
CREATE INDEX idx_activity_type   ON activity_events(event_type);
CREATE INDEX idx_activity_target ON activity_events(target_path);

CREATE TABLE file_derivatives (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_file_id      UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    child_file_id       UUID REFERENCES files(id) ON DELETE SET NULL,
    derivative_type     TEXT NOT NULL,
    ordinal             INT,
    original_name       TEXT,
    extracted_path      TEXT,
    metadata            JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deriv_parent ON file_derivatives(parent_file_id);
CREATE INDEX idx_deriv_child  ON file_derivatives(child_file_id);


-- ============================================================
-- INGEST ORCHESTRATION LAYER
-- ============================================================

CREATE TABLE ingest_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_label    TEXT NOT NULL,
    drive_root_path TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','done','done_with_errors','failed','cancelled')),
    current_stage   TEXT,
    options         JSONB,
    error           TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ingest_jobs_status ON ingest_jobs(status);

CREATE TABLE ingest_stage_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES ingest_jobs(id) ON DELETE CASCADE,
    stage_name      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','done','failed','skipped')),
    processed_count INT DEFAULT 0,
    success_count   INT DEFAULT 0,
    failed_count    INT DEFAULT 0,
    skipped_count   INT DEFAULT 0,
    error           TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (job_id, stage_name)
);

CREATE INDEX idx_ingest_stage_job ON ingest_stage_runs(job_id);

CREATE TABLE document_processing_groups (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sha256_hash            VARCHAR(64) NOT NULL,
    extension              VARCHAR(20) NOT NULL,
    representative_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    total_files            INT NOT NULL DEFAULT 0,
    priority               INT NOT NULL DEFAULT 100,
    is_likely_form         BOOLEAN DEFAULT FALSE,
    status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','converted','extracted','propagated','failed','skipped')),
    convert_status         TEXT NOT NULL DEFAULT 'pending'
                           CHECK (convert_status IN ('pending','done','failed','skipped')),
    extract_status         TEXT NOT NULL DEFAULT 'pending'
                           CHECK (extract_status IN ('pending','done','failed','skipped')),
    converted_path         TEXT,
    processor_name         TEXT,
    error                  TEXT,
    metadata               JSONB,
    created_at             TIMESTAMPTZ DEFAULT NOW(),
    processed_at           TIMESTAMPTZ,
    UNIQUE (sha256_hash, extension)
);

CREATE INDEX idx_doc_groups_hash ON document_processing_groups(sha256_hash);
CREATE INDEX idx_doc_groups_status ON document_processing_groups(status);
CREATE INDEX idx_doc_groups_priority ON document_processing_groups(priority);

CREATE TABLE document_processing_group_files (
    group_id          UUID NOT NULL REFERENCES document_processing_groups(id) ON DELETE CASCADE,
    file_id           UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    is_representative BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (group_id, file_id),
    UNIQUE (file_id)
);

CREATE INDEX idx_doc_group_files_file ON document_processing_group_files(file_id);

CREATE TABLE document_processing_group_results (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id            UUID NOT NULL REFERENCES document_processing_groups(id) ON DELETE CASCADE,
    source_file_id      UUID REFERENCES files(id) ON DELETE SET NULL,
    converted_path      TEXT,
    processor_name      TEXT,
    processor_version   TEXT,
    extraction_status   TEXT NOT NULL DEFAULT 'pending'
                        CHECK (extraction_status IN ('pending','done','failed','skipped')),
    text_content        TEXT,
    language            VARCHAR(20),
    char_count          INT DEFAULT 0,
    chunk_count         INT DEFAULT 0,
    error               TEXT,
    metadata            JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (group_id)
);

CREATE INDEX idx_doc_group_results_group  ON document_processing_group_results(group_id);
CREATE INDEX idx_doc_group_results_status ON document_processing_group_results(extraction_status);


-- ============================================================
-- CONTENT LAYER
-- ============================================================

CREATE TABLE extracted_contents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id             UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    email_message_id    UUID REFERENCES email_messages(id) ON DELETE CASCADE,
    content_kind        TEXT NOT NULL,
    unit_type           TEXT NOT NULL,
    unit_index          INT DEFAULT 0,
    text_content        TEXT,
    language            VARCHAR(20),
    char_count          INT,
    confidence          FLOAT CHECK (confidence BETWEEN 0 AND 1),
    processor_name      TEXT,
    processor_version   TEXT,
    model_name          TEXT,
    prompt_version      TEXT,
    metadata            JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_econtent_file  ON extracted_contents(file_id);
CREATE INDEX idx_econtent_email ON extracted_contents(email_message_id);
CREATE INDEX idx_econtent_kind  ON extracted_contents(content_kind);

CREATE TABLE content_chunks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id          UUID NOT NULL REFERENCES extracted_contents(id) ON DELETE CASCADE,
    file_id             UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    chunk_index         INT NOT NULL,
    chunk_text          TEXT NOT NULL,
    token_count         INT,
    char_start          INT,
    char_end            INT,
    UNIQUE (content_id, chunk_index)
);

CREATE INDEX idx_chunk_content ON content_chunks(content_id);
CREATE INDEX idx_chunk_file    ON content_chunks(file_id);

CREATE TABLE embedding_refs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id                UUID NOT NULL REFERENCES content_chunks(id) ON DELETE CASCADE,
    file_id                 UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    vector_db_collection    TEXT NOT NULL,
    vector_db_id            TEXT NOT NULL,
    embedding_model         VARCHAR(100) DEFAULT 'solar-embedding-1-large-passage',
    vector_dimension        INT DEFAULT 4096,
    content_hash            VARCHAR(64),
    embedded_at             TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (chunk_id, embedding_model, vector_db_collection),
    UNIQUE (vector_db_collection, vector_db_id)
);

CREATE INDEX idx_embed_chunk  ON embedding_refs(chunk_id);
CREATE INDEX idx_embed_vdb_id ON embedding_refs(vector_db_id);

CREATE VIEW v_content_chunk_context AS
SELECT
    cc.id                  AS chunk_id,
    cc.content_id,
    cc.file_id,
    f.evidence_source_id,
    es.user_id,
    u.name                 AS user_name,
    es.source_label,
    es.source_type,
    es.drive_root_path,
    f.original_path,
    f.relative_path,
    f.filename,
    f.extension,
    f.sha256_hash,
    cc.chunk_index,
    cc.chunk_text,
    cc.token_count,
    cc.char_start,
    cc.char_end
FROM content_chunks cc
JOIN files f              ON f.id = cc.file_id
JOIN evidence_sources es  ON es.id = f.evidence_source_id
JOIN users u              ON u.id = es.user_id;


-- ============================================================
-- INTELLIGENCE LAYER
-- ============================================================

CREATE TABLE entity_canonical (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     entity_kind NOT NULL,
    canonical_value TEXT NOT NULL,
    aliases         JSONB,
    metadata        JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (entity_type, canonical_value)
);

CREATE INDEX idx_canonical_type  ON entity_canonical(entity_type);
CREATE INDEX idx_canonical_value ON entity_canonical(canonical_value);

CREATE TABLE entities (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id             UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    content_id          UUID REFERENCES extracted_contents(id) ON DELETE SET NULL,
    chunk_id            UUID REFERENCES content_chunks(id) ON DELETE SET NULL,
    canonical_entity_id UUID REFERENCES entity_canonical(id),
    entity_type         entity_kind,
    raw_value           TEXT NOT NULL,
    confidence          FLOAT CHECK (confidence BETWEEN 0 AND 1),
    context_snippet     TEXT,
    char_offset         INT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_entity_file      ON entities(file_id);
CREATE INDEX idx_entity_canonical ON entities(canonical_entity_id);
CREATE INDEX idx_entity_type      ON entities(entity_type);

CREATE TABLE file_relations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file_id  UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    target_file_id  UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    relation_type   relation_kind NOT NULL,
    similarity_score FLOAT,
    confidence      FLOAT DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
    metadata        JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_file_id, target_file_id, relation_type)
);

CREATE INDEX idx_rel_source ON file_relations(source_file_id);
CREATE INDEX idx_rel_target ON file_relations(target_file_id);
CREATE INDEX idx_rel_type   ON file_relations(relation_type);


-- ============================================================
-- AUDIT / EMPLOYEE LAYER (사내 정기 점검) — investigation_sessions FK 위해 먼저 정의
-- ============================================================

CREATE TABLE employees (
    employee_id  VARCHAR(20) PRIMARY KEY,
    name         VARCHAR(50) NOT NULL,
    position     VARCHAR(50) NOT NULL,
    department   VARCHAR(50) NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE auth_admins (
    admin_id      VARCHAR(50) PRIMARY KEY,
    password_hash TEXT NOT NULL,
    name          VARCHAR(50),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- INVESTIGATION LAYER
-- ============================================================

CREATE TABLE cases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT,
    charge_type     TEXT,
    status          TEXT DEFAULT 'active'
                    CHECK (status IN ('active','paused','closed','archived')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cases_status ON cases(status);

CREATE TABLE investigation_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         UUID REFERENCES cases(id) ON DELETE SET NULL,
    query_text      TEXT NOT NULL,
    query_intent    TEXT,
    status          TEXT DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
    started_at          TIMESTAMPTZ DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    report_storage_uri  TEXT,
    report_json         JSONB,
    agent_trace         JSONB,
    admin_narrative     JSONB,
    employee_id         VARCHAR(20) REFERENCES employees(employee_id),
    quarter             TEXT
);

CREATE TABLE findings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES investigation_sessions(id) ON DELETE CASCADE,
    finding_type    TEXT NOT NULL
                    CHECK (finding_type IN ('anomaly','contradiction','timeline_gap',
                                            'suspicious_pattern','normal')),
    evidence_role   TEXT DEFAULT 'unknown'
                    CHECK (evidence_role IN ('supporting','counter','neutral','unknown')),
    severity        TEXT CHECK (severity IN ('high','medium','low')),
    title           TEXT,
    description     TEXT,
    agent_name      TEXT,
    evidence_start_at TIMESTAMPTZ,
    evidence_end_at   TIMESTAMPTZ,
    confidence      FLOAT CHECK (confidence BETWEEN 0 AND 1),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_finding_session  ON findings(session_id);
CREATE INDEX idx_finding_type     ON findings(finding_type);
CREATE INDEX idx_finding_severity ON findings(severity);

CREATE TABLE finding_evidence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finding_id      UUID NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    evidence_source TEXT NOT NULL
                    CHECK (evidence_source IN (
                        'files', 'email_messages', 'activity_events',
                        'content_chunks', 'entities', 'email_attachments'
                    )),
    evidence_id     UUID NOT NULL,
    note            TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (finding_id, evidence_source, evidence_id)
);

CREATE INDEX idx_fevidence_finding ON finding_evidence(finding_id);
CREATE INDEX idx_fevidence_source  ON finding_evidence(evidence_source, evidence_id);


-- ============================================================
-- AUDIT CONSENT / EXPLANATION / INBOX LAYER
-- ============================================================

CREATE TABLE consents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          UUID NOT NULL REFERENCES investigation_sessions(id) ON DELETE CASCADE,
    employee_id         VARCHAR(20) NOT NULL REFERENCES employees(employee_id),
    consent_type        TEXT NOT NULL CHECK (consent_type IN ('system_use','messenger_access')),
    agreement_text      TEXT NOT NULL,
    signature_png_b64   TEXT NOT NULL,
    signature_hash      VARCHAR(64) NOT NULL,
    client_ip           VARCHAR(45),
    user_agent          TEXT,
    signed_at           TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (session_id, consent_type)
);

CREATE INDEX idx_consents_session ON consents(session_id);

CREATE TABLE explanations (
    session_id    UUID PRIMARY KEY REFERENCES investigation_sessions(id) ON DELETE CASCADE,
    employee_id   VARCHAR(20) NOT NULL REFERENCES employees(employee_id),
    text          TEXT NOT NULL,
    submitted_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE admin_inbox (
    session_id    UUID PRIMARY KEY REFERENCES investigation_sessions(id) ON DELETE CASCADE,
    employee_id   VARCHAR(20) NOT NULL REFERENCES employees(employee_id),
    status        TEXT NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted','reviewed')),
    submitted_at  TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at   TIMESTAMPTZ
);

CREATE INDEX idx_inbox_status ON admin_inbox(status, submitted_at DESC);


-- ============================================================
-- GDB EXPORT VIEWS
-- ============================================================

CREATE VIEW v_gdb_edges_email AS
SELECT
    'emailsent:' || em.id::text || ':' || md5(lower(r.recipient))
                                    AS edge_id,
    'email_identity'                AS source_type,
    'email:' || lower(em.sender)    AS source_id,
    'email_identity'                AS target_type,
    'email:' || lower(r.recipient)  AS target_id,
    'SENT_TO'                       AS relation_type,
    em.sender || ' → ' || r.recipient AS label,
    1.0::FLOAT                      AS confidence,
    em.sent_at,
    em.id                           AS email_id,
    em.subject
FROM email_messages em,
LATERAL jsonb_array_elements_text(
    COALESCE(em.recipients_to, '[]'::jsonb)
) AS r(recipient)
WHERE em.sender IS NOT NULL;

CREATE VIEW v_gdb_edges_mailbox AS
SELECT
    'mailbox:' || u.id::text || ':' || em.id::text AS edge_id,
    'user'                          AS source_type,
    'user:' || u.id::text           AS source_id,
    'email'                         AS target_type,
    'emailmsg:' || em.id::text      AS target_id,
    'HAS_EMAIL_RECORD'              AS relation_type,
    u.name || ' 보유: ' || COALESCE(em.subject, '(제목없음)') AS label,
    1.0::FLOAT                      AS confidence,
    em.sent_at,
    em.id                           AS email_id
FROM email_messages em
JOIN files f             ON f.id = em.source_file_id
JOIN evidence_sources es ON es.id = f.evidence_source_id
JOIN users u             ON u.id = es.user_id;

CREATE VIEW v_gdb_edges_activity AS
SELECT
    'act:' || ae.id::text           AS edge_id,
    'user'                          AS source_type,
    'user:' || u.id::text           AS source_id,
    'event'                         AS target_type,
    'event:' || ae.id::text         AS target_id,
    ae.event_type                   AS relation_type,
    u.name || ' / ' || ae.event_type AS label,
    ae.confidence,
    ae.event_at,
    ae.target_path,
    ae.process_name
FROM activity_events ae
JOIN evidence_sources es ON es.id = ae.evidence_source_id
JOIN users u             ON u.id = es.user_id;

CREATE VIEW v_gdb_edges_mentions AS
SELECT
    'mention:' || e.id::text        AS edge_id,
    'file'                          AS source_type,
    'file:' || e.file_id::text      AS source_id,
    ec.entity_type::TEXT            AS target_type,
    'entity:' || ec.id::text        AS target_id,
    'MENTIONS'                      AS relation_type,
    f.filename || ' → ' || ec.canonical_value AS label,
    e.confidence
FROM entities e
JOIN files f             ON f.id = e.file_id
JOIN entity_canonical ec ON ec.id = e.canonical_entity_id
WHERE e.canonical_entity_id IS NOT NULL
  AND ec.entity_type::text != 'amount';

CREATE VIEW v_gdb_edges_file_rel AS
SELECT
    'rel:' || fr.id::text                   AS edge_id,
    'file'                                  AS source_type,
    'file:' || fr.source_file_id::text      AS source_id,
    'file'                                  AS target_type,
    'file:' || fr.target_file_id::text      AS target_id,
    fr.relation_type::TEXT                  AS relation_type,
    sf.filename || ' → ' || tf.filename     AS label,
    fr.confidence
FROM file_relations fr
JOIN files sf ON sf.id = fr.source_file_id
JOIN files tf ON tf.id = fr.target_file_id;

CREATE VIEW v_gdb_nodes AS

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

SELECT DISTINCT
       'email:' || lower(sender)    AS node_id,
       'email_identity'             AS node_type,
       lower(sender)                AS label,
       jsonb_build_object('source', 'sender') AS properties
FROM email_messages
WHERE sender IS NOT NULL

UNION ALL

SELECT DISTINCT
       'email:' || lower(r.recipient) AS node_id,
       'email_identity'               AS node_type,
       lower(r.recipient)             AS label,
       jsonb_build_object('source', 'recipient') AS properties
FROM email_messages em,
LATERAL jsonb_array_elements_text(
    COALESCE(em.recipients_to, '[]'::jsonb)
) AS r(recipient)
WHERE r.recipient IS NOT NULL;


-- ============================================================
-- FULL-TEXT / TRIGRAM SEARCH INDEXES
-- ============================================================

-- ILIKE '%keyword%' 검색이 seq scan 대신 인덱스를 사용하도록
CREATE INDEX idx_email_body_trgm    ON email_messages USING GIN(body_text    gin_trgm_ops);
CREATE INDEX idx_email_subject_trgm ON email_messages USING GIN(subject      gin_trgm_ops);
CREATE INDEX idx_email_sender_trgm  ON email_messages USING GIN(sender       gin_trgm_ops);
CREATE INDEX idx_content_text_trgm  ON extracted_contents USING GIN(text_content gin_trgm_ops);
CREATE INDEX idx_files_name_trgm    ON files          USING GIN(filename     gin_trgm_ops);


-- ============================================================
-- AUDIT FINDINGS LAYER  (20260512_audit_schema.sql 병합)
-- ============================================================

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


-- ============================================================
-- SEED DATA (사내 정기 점검 데모)
-- ============================================================

INSERT INTO employees(employee_id, name, position, department) VALUES
    ('EMP001', '강수민', '대리', '구매팀'),
    ('EMP002', '이지수', '사원', '구매팀'),
    ('EMP003', '장국주', '과장', '구매팀');

INSERT INTO auth_admins(admin_id, password_hash, name) VALUES
    ('admin', crypt('admin1234', gen_salt('bf', 10)), '관리자');
