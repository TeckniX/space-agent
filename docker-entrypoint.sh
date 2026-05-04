#!/usr/bin/env bash
# Space Agent container entrypoint (used with tini as PID 1).
#
# Default (no image CMD / docker run args): persist CUSTOMWARE_PATH, optionally
# seed the admin user once, then exec `node space supervise`.
#
# Custom command: any docker CMD or trailing `docker run ... -- command` is
# exec-replaced as-is (no bootstrap), so operators own env and ordering.
#   docker run … bash
#   docker run … node space serve HOST=0.0.0.0 PORT=3000
#
# Env (defaults):
#   CUSTOMWARE_PATH   Writable L1/L2 root (default: /srv/space/customware)
#   HOST, PORT        Passed through to supervise/serve via process env / .env
#
# Bootstrap toggles:
#   SPACE_SKIP_INIT=1
#       Skip bootstrap entirely; requires a non-empty command (exec "$@").
#   SPACE_SKIP_ADMIN_BOOTSTRAP=1
#       Skip admin user creation only (still runs `node space set CUSTOMWARE_PATH=…`).
#   SPACE_BOOTSTRAP_BEFORE_CMD=1
#       When a custom command is present, run bootstrap first, then exec "$@".
#
# Admin seed (only if ${CUSTOMWARE_PATH}/L2/admin does not exist):
#   SPACE_ADMIN_PASSWORD   (default: change-me-now)
#   SPACE_ADMIN_FULL_NAME  (default: Admin)

# Fail fast on errors, treat unset variables as errors, and catch failures in pipelines.
set -euo pipefail

# App root for `node space …` (WORKDIR in the image is /app; this script lives at /).
cd /app

# Writable L1/L2 backend root: default for containers; export so child processes see it.
export CUSTOMWARE_PATH="${CUSTOMWARE_PATH:-/data/customware}"
# Support NODE_ENV, RAILWAY_ENVIRONMENT, or default to production
if [[ -n "${NODE_ENV:-}" ]]; then
  export NODE_ENV="$NODE_ENV"
elif [[ -n "${RAILWAY_ENVIRONMENT:-}" ]]; then
  export NODE_ENV="$RAILWAY_ENVIRONMENT"
else
  export NODE_ENV="production"
fi
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"
export WORKERS="${WORKERS:-1}"

# Ensure the path exists before user create / supervise touch it.
mkdir -p "${CUSTOMWARE_PATH}"

# Treat common boolean spellings as true for SPACE_DOCKER_* toggles.
truthy() {
  case "${1:-}" in
  1 | true | yes | on) return 0 ;;
  *) return 1 ;;
  esac
}

# Persist CUSTOMWARE_PATH into project `.env` so CLI and supervise agree with the container layout.
bootstrap_customware_path() {
  node space set "CUSTOMWARE_PATH=${CUSTOMWARE_PATH}"
}

# One-time admin seed: `space user create` fails if the user already exists.
# When DATABASE_URL is configured, users are stored in the identity database
# instead of the filesystem, so we check both places.
bootstrap_admin_if_missing() {
  # Opt-out of admin only (run_bootstrap still runs bootstrap_customware_path before this runs).
  if truthy "${SPACE_SKIP_ADMIN_BOOTSTRAP:-}"; then
    return 0
  fi

  local admin_dir="${CUSTOMWARE_PATH}/L2/admin"

  # Check if admin already exists on filesystem
  if [[ -d "${admin_dir}" ]]; then
    return 0
  fi

  # Check identity database if DATABASE_URL is configured
  if [[ -n "${DATABASE_URL:-}" ]]; then
    # Ensure the identity schema exists before checking for users
    node --input-type=module -e "
      import { ensureIdentitySchemaIfConfigured, userIdentityExists } from './server/lib/auth/identity_db.js';
      import { createRuntimeParams } from './server/lib/utils/runtime_params.js';

      const runtimeParams = await createRuntimeParams(process.cwd(), { env: process.env });
      await ensureIdentitySchemaIfConfigured(runtimeParams);
      const exists = await userIdentityExists(runtimeParams, 'admin');
      process.exit(exists ? 0 : 1);
    " 2>/dev/null && return 0
  fi

  local pw="${SPACE_ADMIN_PASSWORD:-change-me-now}"
  local fn="${SPACE_ADMIN_FULL_NAME:-Admin}"
  node space user create admin --password "${pw}" --full-name "${fn}" --groups _admin
}

run_bootstrap() {
  # `.env` must list CUSTOMWARE_PATH before user create writes under CUSTOMWARE_PATH/L2/…
  bootstrap_customware_path
  bootstrap_admin_if_missing
}

# Operator wants raw control: no `space set`, no admin seed — only exec the given command.
if truthy "${SPACE_SKIP_INIT:-}"; then
  if [[ "$#" -eq 0 ]]; then
    echo "docker-entrypoint: SPACE_SKIP_INIT is set but no command was given." >&2
    exit 2
  fi
  # Hand off PID 1 role to the user command (still under tini).
  exec "$@"
fi

# Image CMD or `docker run … cmd`: replace this shell with the supplied command.
# Optionally run bootstrap first when SPACE_BOOTSTRAP_BEFORE_CMD is set.
if [[ "$#" -gt 0 ]]; then
  if truthy "${SPACE_BOOTSTRAP_BEFORE_CMD:-}"; then
    run_bootstrap
  fi
  # Custom process becomes the main container workload.
  exec "$@"
fi

# No CMD args: default production path — bootstrap then supervise (HOST/PORT from env / .env).
run_bootstrap
# Supervise stays in the foreground; signals go to the Node process under tini.

if [[ "${NODE_ENV}" == "development" ]]; then
  CMD="node space server"
else
  CMD="node space supervise --auto-update-interval 0"
fi

exec ${CMD} HOST=${HOST} PORT=${PORT} CUSTOMWARE_PATH=${CUSTOMWARE_PATH} WORKERS=${WORKERS}
