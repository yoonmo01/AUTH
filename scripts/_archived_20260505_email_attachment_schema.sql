ALTER TABLE email_attachments
ADD COLUMN IF NOT EXISTS sha256_hash VARCHAR(64);

ALTER TABLE email_attachments
ADD COLUMN IF NOT EXISTS extracted_path TEXT;

ALTER TABLE email_attachments
ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE email_attachments
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_eattach_file
ON email_attachments(file_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eattach_unique
ON email_attachments(email_id, attachment_name, size_bytes, sha256_hash);
