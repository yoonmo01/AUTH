-- Migration: add admin_narrative column to investigation_sessions
-- Safe: ADD COLUMN IF NOT EXISTS — existing rows unaffected, NULL by default
ALTER TABLE investigation_sessions
  ADD COLUMN IF NOT EXISTS admin_narrative JSONB;
