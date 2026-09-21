-- Phase 2 — Migration 001: Extensions
-- Run with: psql -f supabase/migrations/001_extensions.sql
-- Idempotent: safe to re-run.

create extension if not exists "pgcrypto";

-- Used for gen_random_uuid() (built-in to pgcrypto in modern Postgres, but
-- we make it explicit so the migration works on any Supabase project).
