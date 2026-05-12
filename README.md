# HYENA RDB Clean Rebuild

This repository builds a clean, reproducible PostgreSQL RDB from the HYENA CTF evidence set.

The default pipeline is non-AI:

- file and directory scan
- file classification
- PST-only email parsing
- PST attachment extraction
- document grouping
- converted DOCX/HWPX cache reuse
- document text extraction
- HWP-DOC same-folder format-variant repair
- group result propagation
- audit

Image OCR, audio STT, embedding, Upstage Document AI, VectorDB, and GraphDB are prepared as later stages but are skipped until API keys are configured.

## Data Layout

Do not commit evidence files or converted artifacts to git.

After cloning, place data like this:

```text
repo/
  data/
    HYENA CTF/
    converted_documents/
```

`converted_documents` should contain:

```text
converted_documents/
  docx/
  hwpx/
  manifest.jsonl
```

The manifest lets a new DB reuse old converted files even when new file UUIDs are generated.

## Quick Start

```powershell
copy .env.example .env
python -m venv .venv
.venv\Scripts\pip.exe install -r requirements.txt

scripts\clean_rebuild.ps1 `
  -DataRoot ".\data\HYENA CTF" `
  -ConvertedRoot ".\data\converted_documents"
```

This starts a separate PostgreSQL container:

```text
container: hyena_clean_postgres
port:      55432
database:  hyena
user:      hyena
```

It does not reuse or modify the old `hyena_postgres` container.

## API Server

```powershell
.venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000
```

Useful endpoints:

```text
GET  /summary
GET  /ingest/jobs
GET  /ingest/document-groups/summary
GET  /search/content?q=keyword&limit=20
GET  /search/emails?q=keyword&limit=20
GET  /search/files?q=keyword&limit=20
```

## Email Policy

PST is the primary email source.

OST is treated as a local cache. OST files are kept in `files`, but they are marked as skipped and are not loaded into `email_messages` by default.

PST attachments are extracted as evidence files:

```text
PST -> email_messages -> email_attachments -> files -> document extraction
```

## HWP-DOC Format Variant Policy

Some HWP files convert to empty HWPX even though the original folder contains a DOC file with the same form content.

When this happens, the pipeline:

- keeps the original HWP file row
- uses the same-folder DOC text as surrogate text
- creates document/content/chunk rows for the HWP file
- records `file_relations.relation_type = 'format_variant'`
- stores metadata explaining the source DOC file

This is not a byte-identical duplicate. It is a same-folder format variant.

## Converted Cache Reuse

Converted files are resolved in this order:

1. `converted_documents/docx/{sha256}.docx` or `converted_documents/hwpx/{sha256}.hwpx`
2. `converted_documents/manifest.jsonl` using `sha256_hash`
3. old UUID-based filenames such as `{old_file_id}.docx`

This allows a new DB to reuse converted artifacts from an older run.

## AI / Vector / Graph Stages

The repo keeps placeholders for later stages:

- image OCR
- audio/video STT
- Upstage document intelligence
- embedding
- Qdrant load
- Neo4j graph load

Until keys are configured, these stages are intentionally skipped.

## Audit

Run:

```powershell
.venv\Scripts\python.exe scripts\audit_rdb_quality.py
```

Main pass criteria:

- traceability errors are 0
- state mismatches are 0
- PST email quality is reported separately from OST cache status
- attachment coverage is reported
- HWP-DOC format variant coverage is reported

## Clean Rebuild Principle

Use this repository to rebuild from scratch instead of patching an old, partially-mutated DB.

The old DB can be used as a reference, but the target state should be reproducible from:

- source evidence under `data/HYENA CTF`
- converted artifacts under `data/converted_documents`
- this codebase
- a fresh `hyena_clean_postgres` container
