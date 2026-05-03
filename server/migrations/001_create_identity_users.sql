-- Migration: Create identity_users table
-- Description: Stores user identity data for database-backed auth
-- Version: 001

CREATE TABLE IF NOT EXISTS space_identity_users (
    username TEXT PRIMARY KEY,
    user_yaml TEXT NOT NULL DEFAULT '',
    password_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    logins_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    crypto_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    server_share_json JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identity_users_updated_at
    ON space_identity_users(updated_at DESC);