import pg from "pg";

const pools = new Map();

function normalizeDatabaseUrl(runtimeParams) {
  const fromParams =
    runtimeParams && typeof runtimeParams.get === "function"
      ? String(runtimeParams.get("DATABASE_URL", "") || "").trim()
      : "";
  return fromParams || String(process.env.DATABASE_URL || "").trim();
}

function isIdentityDatabaseEnabled(runtimeParams) {
  return Boolean(normalizeDatabaseUrl(runtimeParams));
}

function getPool(runtimeParams) {
  const connectionString = normalizeDatabaseUrl(runtimeParams);

  if (!connectionString) {
    return null;
  }

  if (!pools.has(connectionString)) {
    pools.set(
      connectionString,
      new pg.Pool({
        connectionString,
        max: 10
      })
    );
  }

  return pools.get(connectionString);
}

async function ensureIdentitySchemaIfConfigured(runtimeParams) {
  const pool = getPool(runtimeParams);

  if (!pool) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS space_identity_users (
      username TEXT PRIMARY KEY,
      user_yaml TEXT NOT NULL DEFAULT '',
      password_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      logins_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      crypto_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      server_share_json JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function mapRow(row) {
  if (!row) {
    return null;
  }

  return {
    crypto_json: row.crypto_json || {},
    logins_json: row.logins_json || {},
    password_json: row.password_json || {},
    server_share_json: row.server_share_json || null,
    updated_at: row.updated_at,
    user_yaml: row.user_yaml || "",
    username: row.username
  };
}

async function fetchIdentityRow(runtimeParams, username) {
  const pool = getPool(runtimeParams);

  if (!pool) {
    return null;
  }

  const result = await pool.query(
    `SELECT username, user_yaml, password_json, logins_json, crypto_json, server_share_json, updated_at
     FROM space_identity_users WHERE username = $1`,
    [username]
  );

  return mapRow(result.rows[0]);
}

async function fetchAllIdentityRows(runtimeParams) {
  const pool = getPool(runtimeParams);

  if (!pool) {
    return [];
  }

  const result = await pool.query(
    `SELECT username, user_yaml, password_json, logins_json, crypto_json, server_share_json, updated_at
     FROM space_identity_users ORDER BY username`
  );

  return result.rows.map(mapRow);
}

async function fetchIdentityRowsForUsernames(runtimeParams, usernames) {
  const pool = getPool(runtimeParams);

  if (!pool || !Array.isArray(usernames) || usernames.length === 0) {
    return [];
  }

  const normalized = [...new Set(usernames.map((u) => String(u || "").trim()).filter(Boolean))];

  if (normalized.length === 0) {
    return [];
  }

  const result = await pool.query(
    `SELECT username, user_yaml, password_json, logins_json, crypto_json, server_share_json, updated_at
     FROM space_identity_users WHERE username = ANY($1::text[])`,
    [normalized]
  );

  return result.rows.map(mapRow);
}

async function userIdentityExists(runtimeParams, username) {
  const row = await fetchIdentityRow(runtimeParams, username);
  return Boolean(row);
}

async function deleteIdentityUser(runtimeParams, username) {
  const pool = getPool(runtimeParams);

  if (!pool) {
    return false;
  }

  const result = await pool.query(`DELETE FROM space_identity_users WHERE username = $1`, [username]);
  return result.rowCount > 0;
}

async function clearIdentityServerShare(runtimeParams, username) {
  const pool = getPool(runtimeParams);

  if (!pool) {
    return false;
  }

  const result = await pool.query(
    `UPDATE space_identity_users SET server_share_json = NULL, updated_at = now()
     WHERE username = $1 AND server_share_json IS NOT NULL`,
    [username]
  );
  return result.rowCount > 0;
}

async function upsertFullIdentityUser(runtimeParams, row) {
  const pool = getPool(runtimeParams);

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const serverShare =
    row.server_share_json === undefined ? null : row.server_share_json;

  await pool.query(
    `INSERT INTO space_identity_users (
      username, user_yaml, password_json, logins_json, crypto_json, server_share_json, updated_at
    ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, now())
    ON CONFLICT (username) DO UPDATE SET
      user_yaml = EXCLUDED.user_yaml,
      password_json = EXCLUDED.password_json,
      logins_json = EXCLUDED.logins_json,
      crypto_json = EXCLUDED.crypto_json,
      server_share_json = EXCLUDED.server_share_json,
      updated_at = now()`,
    [
      row.username,
      row.user_yaml ?? "",
      JSON.stringify(row.password_json ?? {}),
      JSON.stringify(row.logins_json ?? {}),
      JSON.stringify(row.crypto_json ?? {}),
      serverShare === null ? null : JSON.stringify(serverShare)
    ]
  );
}

async function patchIdentityUser(runtimeParams, username, patch) {
  const existing = (await fetchIdentityRow(runtimeParams, username)) || {
    crypto_json: {},
    logins_json: {},
    password_json: {},
    server_share_json: null,
    user_yaml: "",
    username
  };

  const next = {
    ...existing,
    ...patch,
    username
  };

  if (patch.server_share_json === undefined) {
    next.server_share_json = existing.server_share_json;
  }

  await upsertFullIdentityUser(runtimeParams, next);
}

export {
  clearIdentityServerShare,
  deleteIdentityUser,
  ensureIdentitySchemaIfConfigured,
  fetchAllIdentityRows,
  fetchIdentityRow,
  fetchIdentityRowsForUsernames,
  getPool,
  isIdentityDatabaseEnabled,
  patchIdentityUser,
  upsertFullIdentityUser,
  userIdentityExists
};
