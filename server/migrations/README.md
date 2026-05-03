# Database Migrations

This directory contains SQL migration files for the space-agent PostgreSQL database.

## Running Migrations

Set the `DATABASE_URL` environment variable and run:

```bash
# From repo root
DATABASE_URL=postgres://user:pass@localhost:5432/dbname node server/migrations/run.js

# Or with docker
docker exec -it space-agent-server node server/migrations/run.js
```

## Available Migrations

| File | Description |
|------|-------------|
| `001_create_identity_users.sql` | Creates the `space_identity_users` table for database-backed user identity storage |

## Troubleshooting

If you see `relation "space_identity_users" does not exist`:
1. Ensure PostgreSQL is running
2. Verify `DATABASE_URL` is set correctly
3. Run the migration: `node server/migrations/run.js`