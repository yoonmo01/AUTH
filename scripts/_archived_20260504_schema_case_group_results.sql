CREATE TABLE IF NOT EXISTS cases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT,
    charge_type     TEXT,
    status          TEXT DEFAULT 'active'
                    CHECK (status IN ('active','paused','closed','archived')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);

ALTER TABLE investigation_sessions
ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES cases(id) ON DELETE SET NULL;

ALTER TABLE file_relations
ADD COLUMN IF NOT EXISTS similarity_score FLOAT;

ALTER TABLE findings
ADD COLUMN IF NOT EXISTS evidence_role TEXT DEFAULT 'unknown';

DO $$
BEGIN
    ALTER TABLE findings
    ADD CONSTRAINT findings_evidence_role_check
    CHECK (evidence_role IN ('supporting','counter','neutral','unknown'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS document_processing_group_results (
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

CREATE INDEX IF NOT EXISTS idx_doc_group_results_group
ON document_processing_group_results(group_id);

CREATE INDEX IF NOT EXISTS idx_doc_group_results_status
ON document_processing_group_results(extraction_status);

CREATE OR REPLACE VIEW v_content_chunk_context AS
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
