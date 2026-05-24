-- Migration: add agent_trace column to investigation_sessions
-- Safe: ADD COLUMN IF NOT EXISTS — existing rows unaffected, NULL by default
ALTER TABLE investigation_sessions
  ADD COLUMN IF NOT EXISTS agent_trace JSONB;
