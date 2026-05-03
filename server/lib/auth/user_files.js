import fs from "node:fs";

import {
  fetchIdentityRow,
  isIdentityDatabaseEnabled,
  patchIdentityUser,
  userIdentityExists
} from "./identity_db.js";
import {
  normalizeEntityId,
  resolveProjectAbsolutePath
} from "../customware/layout.js";
import {
  parseSimpleYaml,
  serializeSimpleYaml
} from "../../../app/L0/_all/mod/_core/framework/js/yaml-lite.js";

const USER_META_DIRNAME = "meta";
const USER_CONFIG_FILENAME = "user.yaml";
const USER_LOGINS_FILENAME = "logins.json";
const USER_PASSWORD_FILENAME = "password.json";
const USER_CRYPTO_FILENAME = "user_crypto.json";

function normalizeUsername(value) {
  return normalizeEntityId(value);
}

function buildUserProjectPath(username, relativePath = "") {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    throw new Error(`Invalid username: ${valueToText(username)}`);
  }

  const suffix = String(relativePath || "").replace(/^\/+/u, "");
  return suffix ? `/app/L2/${normalizedUsername}/${suffix}` : `/app/L2/${normalizedUsername}/`;
}

function buildUserAbsolutePath(projectRoot, username, relativePath = "", runtimeParams = null) {
  return resolveProjectAbsolutePath(
    projectRoot,
    buildUserProjectPath(username, relativePath),
    runtimeParams
  );
}

function valueToText(value) {
  return String(value || "");
}

function readTextFile(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

function readJsonObject(filePath, fallback = {}) {
  const sourceText = readTextFile(filePath, "").trim();

  if (!sourceText) {
    return { ...(fallback || {}) };
  }

  try {
    const parsed = JSON.parse(sourceText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { ...(fallback || {}) };
  } catch {
    return { ...(fallback || {}) };
  }
}

async function readUserConfig(projectRoot, username, runtimeParams = null) {
  if (isIdentityDatabaseEnabled(runtimeParams)) {
    const row = await fetchIdentityRow(runtimeParams, normalizeUsername(username));

    if (!row || !row.user_yaml) {
      return {};
    }

    return parseSimpleYaml(row.user_yaml);
  }

  const filePath = buildUserAbsolutePath(projectRoot, username, USER_CONFIG_FILENAME, runtimeParams);
  const sourceText = readTextFile(filePath, "");
  return sourceText ? parseSimpleYaml(sourceText) : {};
}

async function writeUserConfig(projectRoot, username, config, runtimeParams = null) {
  if (isIdentityDatabaseEnabled(runtimeParams)) {
    const normalizedUsername = normalizeUsername(username);
    const yamlText = serializeSimpleYaml(config);
    await patchIdentityUser(runtimeParams, normalizedUsername, { user_yaml: yamlText });
    return buildUserProjectPath(normalizedUsername, USER_CONFIG_FILENAME);
  }

  const filePath = buildUserAbsolutePath(projectRoot, username, USER_CONFIG_FILENAME, runtimeParams);
  fs.mkdirSync(buildUserAbsolutePath(projectRoot, username, "", runtimeParams), { recursive: true });
  fs.writeFileSync(filePath, serializeSimpleYaml(config), "utf8");
  return filePath;
}

async function readUserPasswordVerifier(projectRoot, username, runtimeParams = null) {
  if (isIdentityDatabaseEnabled(runtimeParams)) {
    const row = await fetchIdentityRow(runtimeParams, normalizeUsername(username));
    return row?.password_json && typeof row.password_json === "object" ? row.password_json : {};
  }

  const filePath = buildUserAbsolutePath(
    projectRoot,
    username,
    `${USER_META_DIRNAME}/${USER_PASSWORD_FILENAME}`,
    runtimeParams
  );
  return readJsonObject(filePath, {});
}

async function writeUserPasswordVerifier(projectRoot, username, verifier, runtimeParams = null) {
  if (isIdentityDatabaseEnabled(runtimeParams)) {
    const normalizedUsername = normalizeUsername(username);
    await patchIdentityUser(runtimeParams, normalizedUsername, {
      password_json: verifier || {}
    });
    return buildUserProjectPath(normalizedUsername, `${USER_META_DIRNAME}/${USER_PASSWORD_FILENAME}`);
  }

  const filePath = buildUserAbsolutePath(
    projectRoot,
    username,
    `${USER_META_DIRNAME}/${USER_PASSWORD_FILENAME}`,
    runtimeParams
  );
  fs.mkdirSync(buildUserAbsolutePath(projectRoot, username, USER_META_DIRNAME, runtimeParams), {
    recursive: true
  });
  fs.writeFileSync(filePath, `${JSON.stringify(verifier || {}, null, 2)}\n`, "utf8");
  return filePath;
}

async function readUserLogins(projectRoot, username, runtimeParams = null) {
  if (isIdentityDatabaseEnabled(runtimeParams)) {
    const row = await fetchIdentityRow(runtimeParams, normalizeUsername(username));
    return row?.logins_json && typeof row.logins_json === "object" ? row.logins_json : {};
  }

  const filePath = buildUserAbsolutePath(
    projectRoot,
    username,
    `${USER_META_DIRNAME}/${USER_LOGINS_FILENAME}`,
    runtimeParams
  );
  return readJsonObject(filePath, {});
}

async function writeUserLogins(projectRoot, username, logins, runtimeParams = null) {
  if (isIdentityDatabaseEnabled(runtimeParams)) {
    const normalizedUsername = normalizeUsername(username);
    await patchIdentityUser(runtimeParams, normalizedUsername, { logins_json: logins || {} });
    return buildUserProjectPath(normalizedUsername, `${USER_META_DIRNAME}/${USER_LOGINS_FILENAME}`);
  }

  const filePath = buildUserAbsolutePath(
    projectRoot,
    username,
    `${USER_META_DIRNAME}/${USER_LOGINS_FILENAME}`,
    runtimeParams
  );
  fs.mkdirSync(buildUserAbsolutePath(projectRoot, username, USER_META_DIRNAME, runtimeParams), {
    recursive: true
  });
  fs.writeFileSync(filePath, `${JSON.stringify(logins || {}, null, 2)}\n`, "utf8");
  return filePath;
}

async function readUserCryptoRecord(projectRoot, username, runtimeParams = null) {
  if (isIdentityDatabaseEnabled(runtimeParams)) {
    const row = await fetchIdentityRow(runtimeParams, normalizeUsername(username));
    return row?.crypto_json && typeof row.crypto_json === "object" ? row.crypto_json : {};
  }

  const filePath = buildUserAbsolutePath(
    projectRoot,
    username,
    `${USER_META_DIRNAME}/${USER_CRYPTO_FILENAME}`,
    runtimeParams
  );
  return readJsonObject(filePath, {});
}

async function writeUserCryptoRecord(projectRoot, username, record, runtimeParams = null) {
  if (isIdentityDatabaseEnabled(runtimeParams)) {
    const normalizedUsername = normalizeUsername(username);
    await patchIdentityUser(runtimeParams, normalizedUsername, { crypto_json: record || {} });
    return buildUserProjectPath(normalizedUsername, `${USER_META_DIRNAME}/${USER_CRYPTO_FILENAME}`);
  }

  const filePath = buildUserAbsolutePath(
    projectRoot,
    username,
    `${USER_META_DIRNAME}/${USER_CRYPTO_FILENAME}`,
    runtimeParams
  );
  fs.mkdirSync(buildUserAbsolutePath(projectRoot, username, USER_META_DIRNAME, runtimeParams), {
    recursive: true
  });
  fs.writeFileSync(filePath, `${JSON.stringify(record || {}, null, 2)}\n`, "utf8");
  return filePath;
}

async function ensureUserStructure(projectRoot, username, runtimeParams = null) {
  const userDir = buildUserAbsolutePath(projectRoot, username, "", runtimeParams);
  const metaDir = buildUserAbsolutePath(projectRoot, username, USER_META_DIRNAME, runtimeParams);
  const modDir = buildUserAbsolutePath(projectRoot, username, "mod", runtimeParams);
  fs.mkdirSync(modDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });
  return {
    metaDir,
    modDir,
    userDir
  };
}

async function userStorageExists(projectRoot, username, runtimeParams = null) {
  if (isIdentityDatabaseEnabled(runtimeParams)) {
    return userIdentityExists(runtimeParams, normalizeUsername(username));
  }

  const userDir = buildUserAbsolutePath(projectRoot, username, "", runtimeParams);
  return fs.existsSync(userDir);
}

export {
  USER_CONFIG_FILENAME,
  USER_CRYPTO_FILENAME,
  USER_LOGINS_FILENAME,
  USER_META_DIRNAME,
  USER_PASSWORD_FILENAME,
  buildUserAbsolutePath,
  buildUserProjectPath,
  ensureUserStructure,
  normalizeUsername,
  readUserConfig,
  readUserCryptoRecord,
  readUserLogins,
  readUserPasswordVerifier,
  userStorageExists,
  writeUserConfig,
  writeUserCryptoRecord,
  writeUserLogins,
  writeUserPasswordVerifier
};
