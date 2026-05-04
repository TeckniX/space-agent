import fs from "node:fs";
import { randomBytes } from "node:crypto";

import { createPasswordVerifier } from "./passwords.js";
import { loadAuthKeys } from "./keys_manage.js";
import { recordAppPathMutations } from "../customware/git_history.js";
import { deleteIdentityUser, isIdentityDatabaseEnabled, upsertFullIdentityUser } from "./identity_db.js";
import {
  deleteUserCryptoArtifacts,
  invalidateUserCryptoRecord,
  writeReadyUserCryptoRecord
} from "./user_crypto.js";
import {
  buildUserAbsolutePath,
  ensureUserStructure,
  normalizeUsername,
  readUserConfig,
  userStorageExists,
  writeUserConfig,
  writeUserLogins,
  writeUserPasswordVerifier
} from "./user_files.js";
import { serializeSimpleYaml } from "../../../app/L0/_all/mod/_core/framework/js/yaml-lite.js";

const GUEST_USERNAME_PREFIX = "guest_";
const GUEST_USERNAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const GENERATED_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const GUEST_USERNAME_SUFFIX_LENGTH = 6;
const GENERATED_PASSWORD_LENGTH = 18;
const GUEST_CREATION_MAX_ATTEMPTS = 64;

function createRandomString(length, alphabet) {
  const normalizedLength = Number(length);
  const sourceAlphabet = String(alphabet || "");

  if (!Number.isInteger(normalizedLength) || normalizedLength <= 0 || !sourceAlphabet) {
    return "";
  }

  const bytes = randomBytes(normalizedLength);
  let output = "";

  for (let index = 0; index < normalizedLength; index += 1) {
    output += sourceAlphabet[bytes[index] % sourceAlphabet.length];
  }

  return output;
}

function removeLegacyPasswordFields(config = {}) {
  const {
    password: _password,
    password_iterations: _passwordIterations,
    password_salt: _passwordSalt,
    password_scheme: _passwordScheme,
    password_server_key: _passwordServerKey,
    password_stored_key: _passwordStoredKey,
    ...rest
  } = config;

  return rest;
}

function normalizeFullName(fullName, username) {
  const normalizedFullName = String(fullName || "").trim();
  return normalizedFullName || String(username || "");
}

async function createUserInternal(projectRoot, username, password, options = {}, authKeys) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    throw new Error(`Invalid username: ${String(username || "")}`);
  }

  const runtimeParams = options.runtimeParams || null;
  const userDir = buildUserAbsolutePath(projectRoot, normalizedUsername, "", runtimeParams);

  if (await userStorageExists(projectRoot, normalizedUsername, runtimeParams)) {
    if (!options.force) {
      throw new Error(`User already exists: ${normalizedUsername}`);
    }

    if (isIdentityDatabaseEnabled(runtimeParams)) {
      await deleteIdentityUser(runtimeParams, normalizedUsername);
    } else {
      fs.rmSync(userDir, { force: true, recursive: true });
    }
  }

  await ensureUserStructure(projectRoot, normalizedUsername, runtimeParams);

  if (isIdentityDatabaseEnabled(runtimeParams)) {
    const verifier = createPasswordVerifier(password, authKeys);
    await upsertFullIdentityUser(runtimeParams, {
      crypto_json: {},
      logins_json: {},
      password_json: verifier,
      server_share_json: null,
      user_yaml: serializeSimpleYaml({
        full_name: normalizeFullName(options.fullName, normalizedUsername)
      }),
      username: normalizedUsername
    });
  } else {
    await writeUserConfig(projectRoot, normalizedUsername, {
      full_name: normalizeFullName(options.fullName, normalizedUsername)
    }, runtimeParams);
    await writeUserPasswordVerifier(
      projectRoot,
      normalizedUsername,
      createPasswordVerifier(password, authKeys),
      runtimeParams
    );
    await writeUserLogins(projectRoot, normalizedUsername, {}, runtimeParams);
  }

  if (!isIdentityDatabaseEnabled(runtimeParams)) {
    recordAppPathMutations(
      {
        projectRoot,
        runtimeParams
      },
      [
        `/app/L2/${normalizedUsername}/`,
        `/app/L2/${normalizedUsername}/meta/`,
        `/app/L2/${normalizedUsername}/meta/logins.json`,
        `/app/L2/${normalizedUsername}/meta/password.json`,
        `/app/L2/${normalizedUsername}/mod/`,
        `/app/L2/${normalizedUsername}/user.yaml`
      ]
    );
  }

  return {
    userDir,
    username: normalizedUsername
  };
}

async function createUser(projectRoot, username, password, options = {}) {
  return createUserInternal(projectRoot, username, password, options, loadAuthKeys(projectRoot));
}

function isGuestUsername(username) {
  return normalizeUsername(username).startsWith(GUEST_USERNAME_PREFIX);
}

async function setUserPassword(projectRoot, username, password, options = {}) {
  const authKeys = loadAuthKeys(projectRoot);
  const normalizedUsername = normalizeUsername(username);
  const invalidateUserCrypto = options.invalidateUserCrypto !== false;
  const runtimeParams = options.runtimeParams || null;
  const userCryptoRecord =
    options.userCryptoRecord && typeof options.userCryptoRecord === "object"
      ? options.userCryptoRecord
      : null;

  if (!normalizedUsername) {
    throw new Error(`Invalid username: ${String(username || "")}`);
  }

  const currentConfig = await readUserConfig(projectRoot, normalizedUsername, runtimeParams);
  const userDir = buildUserAbsolutePath(projectRoot, normalizedUsername, "", runtimeParams);

  if (!(await userStorageExists(projectRoot, normalizedUsername, runtimeParams))) {
    throw new Error(`User does not exist: ${normalizedUsername}`);
  }

  await ensureUserStructure(projectRoot, normalizedUsername, runtimeParams);

  await writeUserConfig(projectRoot, normalizedUsername, {
    ...removeLegacyPasswordFields(currentConfig),
    full_name: normalizeFullName(currentConfig.full_name, normalizedUsername)
  }, runtimeParams);
  await writeUserPasswordVerifier(
    projectRoot,
    normalizedUsername,
    createPasswordVerifier(password, authKeys),
    runtimeParams
  );
  await writeUserLogins(projectRoot, normalizedUsername, {}, runtimeParams);

  if (!isIdentityDatabaseEnabled(runtimeParams)) {
    recordAppPathMutations(
      {
        projectRoot,
        runtimeParams
      },
      [`/app/L2/${normalizedUsername}/meta/password.json`, `/app/L2/${normalizedUsername}/meta/logins.json`]
    );
  }

  if (userCryptoRecord) {
    await writeReadyUserCryptoRecord(projectRoot, normalizedUsername, userCryptoRecord, {
      runtimeParams
    });
  } else if (invalidateUserCrypto) {
    await invalidateUserCryptoRecord(projectRoot, normalizedUsername, {
      runtimeParams
    });
  }

  return {
    userDir,
    username: normalizedUsername
  };
}

async function createGuestUser(projectRoot, options = {}) {
  const authKeys = loadAuthKeys(projectRoot);
  const password = String(options.password || createRandomString(GENERATED_PASSWORD_LENGTH, GENERATED_PASSWORD_ALPHABET));
  const runtimeParams = options.runtimeParams || null;

  for (let attempt = 0; attempt < GUEST_CREATION_MAX_ATTEMPTS; attempt += 1) {
    const username = `${GUEST_USERNAME_PREFIX}${createRandomString(
      GUEST_USERNAME_SUFFIX_LENGTH,
      GUEST_USERNAME_ALPHABET
    )}`;

    if (await userStorageExists(projectRoot, username, runtimeParams)) {
      continue;
    }

    try {
      await createUserInternal(projectRoot, username, password, { runtimeParams }, authKeys);
    } catch (error) {
      if (String(error?.message || "").startsWith("User already exists:")) {
        continue;
      }

      throw error;
    }

    return {
      password,
      username
    };
  }

  throw new Error("Failed to create guest account. Try again.");
}

async function deleteUser(projectRoot, username, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  const runtimeParams = options.runtimeParams || null;

  if (!normalizedUsername) {
    throw new Error(`Invalid username: ${String(username || "")}`);
  }

  if (!(await userStorageExists(projectRoot, normalizedUsername, runtimeParams))) {
    return false;
  }

  if (isIdentityDatabaseEnabled(runtimeParams)) {
    await deleteIdentityUser(runtimeParams, normalizedUsername);
  }

  const userDir = buildUserAbsolutePath(projectRoot, normalizedUsername, "", runtimeParams);

  if (fs.existsSync(userDir)) {
    fs.rmSync(userDir, {
      force: true,
      recursive: true
    });
  }

  await deleteUserCryptoArtifacts(projectRoot, normalizedUsername, runtimeParams);

  if (!isIdentityDatabaseEnabled(runtimeParams)) {
    recordAppPathMutations(
      {
        projectRoot,
        runtimeParams
      },
      [`/app/L2/${normalizedUsername}/`]
    );
  }

  return true;
}

async function deleteGuestUser(projectRoot, username, options = {}) {
  const normalizedUsername = normalizeUsername(username);

  if (!isGuestUsername(normalizedUsername)) {
    throw new Error(`Refusing to delete non-guest user through deleteGuestUser(): ${normalizedUsername}`);
  }

  return deleteUser(projectRoot, normalizedUsername, options);
}

export {
  createGuestUser,
  createUser,
  deleteGuestUser,
  deleteUser,
  isGuestUsername,
  setUserPassword
};
