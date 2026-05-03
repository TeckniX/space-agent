import {
  buildUserIndexSnapshot,
  hydrateUserIndexSnapshot,
  mergeIdentityRowsIntoSerializedSnapshot,
  serializeUserIndexSnapshot
} from "../../auth/user_index.js";
import {
  fetchAllIdentityRows,
  fetchIdentityRowsForUsernames,
  isIdentityDatabaseEnabled
} from "../../auth/identity_db.js";
import {
  parseProjectUserConfigPath,
  parseProjectUserDirectoryPath,
  parseProjectUserLoginsPath,
  parseProjectUserPasswordPath
} from "../../customware/layout.js";
import { WatchdogHandler } from "../watchdog.js";

function collectAffectedUsernames(changes = []) {
  const usernames = new Set();

  for (const change of changes) {
    const projectPath = String(change?.projectPath || "");
    const userDirectoryInfo =
      parseProjectUserDirectoryPath(projectPath) ||
      parseProjectUserConfigPath(projectPath) ||
      parseProjectUserLoginsPath(projectPath) ||
      parseProjectUserPasswordPath(projectPath);

    if (userDirectoryInfo?.username) {
      usernames.add(userDirectoryInfo.username);
    }
  }

  return [...usernames].sort((left, right) => left.localeCompare(right));
}

function getUserProjectPaths(pathIndex, username) {
  const prefix = `/app/L2/${username}/`;

  return Object.keys(pathIndex || Object.create(null))
    .filter((projectPath) => projectPath === prefix || projectPath.startsWith(prefix))
    .sort((left, right) => left.localeCompare(right));
}

function removeUserState(state, username) {
  if (!state?.users || !state?.sessions) {
    return;
  }

  delete state.users[username];

  for (const [sessionVerifier, session] of Object.entries(state.sessions)) {
    if (String(session?.username || "") === username) {
      delete state.sessions[sessionVerifier];
    }
  }

  const userPrefix = `/app/L2/${username}/`;
  state.errors = (Array.isArray(state.errors) ? state.errors : []).filter(
    (error) => !String(error?.projectPath || "").startsWith(userPrefix)
  );
}

export default class UserIndexHandler extends WatchdogHandler {
  createInitialState() {
    return buildUserIndexSnapshot({
      filePaths: [],
      projectRoot: this.projectRoot,
      runtimeParams: this.runtimeParams
    });
  }

  rebuild(context, identityRows = null) {
    this.state = buildUserIndexSnapshot({
      filePaths: context.getCurrentPaths(),
      identityRows: identityRows || undefined,
      projectRoot: this.projectRoot,
      runtimeParams: this.runtimeParams
    });
  }

  async onStart(context) {
    let identityRows = null;

    if (isIdentityDatabaseEnabled(this.runtimeParams)) {
      identityRows = await fetchAllIdentityRows(this.runtimeParams);
    }

    this.rebuild(context, identityRows);
  }

  async onChanges(context) {
    const affectedUsernames = collectAffectedUsernames(context.changes);

    if (affectedUsernames.length === 0) {
      return;
    }

    const nextState = serializeUserIndexSnapshot(this.state);
    const identityRows =
      isIdentityDatabaseEnabled(this.runtimeParams) && affectedUsernames.length > 0
        ? await fetchIdentityRowsForUsernames(this.runtimeParams, affectedUsernames)
        : [];

    for (const username of affectedUsernames) {
      removeUserState(nextState, username);

      const shardValue =
        typeof context.getFileIndexShard === "function"
          ? context.getFileIndexShard(`L2/${username}`)
          : Object.create(null);
      const partialSnapshot = buildUserIndexSnapshot({
        filePaths: getUserProjectPaths(shardValue, username),
        projectRoot: this.projectRoot,
        runtimeParams: this.runtimeParams
      });
      const serializedPartialSnapshot = serializeUserIndexSnapshot(partialSnapshot);

      if (serializedPartialSnapshot.users[username]) {
        nextState.users[username] = serializedPartialSnapshot.users[username];
      }

      Object.assign(nextState.sessions, serializedPartialSnapshot.sessions);
      nextState.errors.push(...serializedPartialSnapshot.errors);
    }

    if (identityRows.length > 0) {
      const merged = mergeIdentityRowsIntoSerializedSnapshot(nextState, identityRows);
      nextState.users = merged.users;
      nextState.sessions = merged.sessions;
      nextState.errors = merged.errors;
    }

    this.state = hydrateUserIndexSnapshot(nextState);
  }

  restoreState(state) {
    this.state = hydrateUserIndexSnapshot(state);
  }

  serializeState(state) {
    return serializeUserIndexSnapshot(state);
  }
}
