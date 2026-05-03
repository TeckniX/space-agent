import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  copyAppPath,
  deleteAppPath,
  writeAppFile,
  writeAppFiles
} from "../server/lib/customware/file_access.js";
import { clearUserFolderSizeCache } from "../server/lib/customware/user_quota.js";
import { createRuntimeParams } from "../server/lib/utils/runtime_params.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIR, "..");

function createStaticRuntimeParams(values = {}) {
  return {
    get(name, fallback = undefined) {
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : fallback;
    }
  };
}

function collectProjectPaths(projectRoot) {
  const appRoot = path.join(projectRoot, "app");
  const output = [];

  function walk(absolutePath) {
    if (!fs.existsSync(absolutePath)) {
      return;
    }

    const stats = fs.statSync(absolutePath);
    const relativePath = path.relative(appRoot, absolutePath).replaceAll(path.sep, "/");
    const projectPath = relativePath
      ? `/app/${relativePath}${stats.isDirectory() ? "/" : ""}`
      : "/app/";

    output.push(projectPath);

    if (!stats.isDirectory()) {
      return;
    }

    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      walk(path.join(absolutePath, entry.name));
    }
  }

  walk(appRoot);
  return output.sort((left, right) => left.localeCompare(right));
}

function createWatchdog(projectRoot) {
  const paths = collectProjectPaths(projectRoot);
  const pathIndex = Object.create(null);
  const appRoot = path.join(projectRoot, "app");

  for (const projectPath of paths) {
    const isDirectory = projectPath.endsWith("/");
    const relativePath = projectPath
      .slice("/app/".length)
      .replace(/\/$/u, "")
      .replaceAll("/", path.sep);
    const absolutePath = relativePath ? path.join(appRoot, relativePath) : appRoot;
    const stats = fs.statSync(absolutePath);

    pathIndex[projectPath] = {
      isDirectory,
      mtimeMs: Math.trunc(Number(stats.mtimeMs || 0)),
      sizeBytes: isDirectory ? 0 : Number(stats.size || 0)
    };
  }

  return {
    getIndex(name) {
      return name === "path_index" ? pathIndex : Object.create(null);
    },
    getPaths() {
      return [...paths];
    }
  };
}

function createProjectRoot() {
  clearUserFolderSizeCache();
  return fs.mkdtempSync(path.join(os.tmpdir(), "space-user-folder-quota-"));
}

function seedAlice(projectRoot, files = { "notes.txt": "" }) {
  const base = path.join(projectRoot, "app", "L2", "alice");
  fs.mkdirSync(base, { recursive: true });

  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(base, ...rel.split("/"));
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
}

async function assertQuotaReject(asyncFn) {
  await assert.rejects(asyncFn, (error) => {
    assert.equal(error.statusCode, 413);
    assert.match(error.message, /User folder size limit exceeded/u);
    return true;
  });
}

function readUserFile(projectRoot, username, filePath) {
  return fs.readFileSync(path.join(projectRoot, "app", "L2", username, filePath), "utf8");
}

async function main() {
  {
    const runtimeParams = await createRuntimeParams(PROJECT_ROOT, {
      env: {},
      overrides: {
        PORT: "0",
        USER_FOLDER_SIZE_LIMIT_BYTES: "0"
      },
      storedValues: {}
    });

    assert.equal(runtimeParams.get("PORT"), 0);
    assert.equal(runtimeParams.get("USER_FOLDER_SIZE_LIMIT_BYTES"), 0);
  }

  {
    const projectRoot = createProjectRoot();
    seedAlice(projectRoot, { "notes.txt": "" });
    const runtimeParams = createStaticRuntimeParams({
      USER_FOLDER_SIZE_LIMIT_BYTES: 10
    });
    const watchdog = createWatchdog(projectRoot);

    await writeAppFile({
      content: "1234567890",
      path: "~/notes.txt",
      projectRoot,
      runtimeParams,
      username: "alice",
      watchdog
    });

    assert.equal(readUserFile(projectRoot, "alice", "notes.txt"), "1234567890");
    await assertQuotaReject(async () => {
      await writeAppFile({
        content: "12345678901",
        path: "~/notes.txt",
        projectRoot,
        runtimeParams,
        username: "alice",
        watchdog: createWatchdog(projectRoot)
      });
    });
    assert.equal(readUserFile(projectRoot, "alice", "notes.txt"), "1234567890");
  }

  {
    const projectRoot = createProjectRoot();
    seedAlice(projectRoot, { "notes.txt": "" });
    const runtimeParams = createStaticRuntimeParams({
      USER_FOLDER_SIZE_LIMIT_BYTES: 10
    });

    await writeAppFile({
      content: "12345",
      path: "~/notes.txt",
      projectRoot,
      runtimeParams,
      username: "alice",
      watchdog: createWatchdog(projectRoot)
    });

    await assertQuotaReject(async () => {
      await writeAppFile({
        content: "678901",
        operation: "append",
        path: "~/notes.txt",
        projectRoot,
        runtimeParams,
        username: "alice",
        watchdog: createWatchdog(projectRoot)
      });
    });

    assert.equal(readUserFile(projectRoot, "alice", "notes.txt"), "12345");
  }

  {
    const projectRoot = createProjectRoot();
    seedAlice(projectRoot, { "notes.txt": "" });
    const unboundedRuntimeParams = createStaticRuntimeParams({
      USER_FOLDER_SIZE_LIMIT_BYTES: 0
    });
    const quotaRuntimeParams = createStaticRuntimeParams({
      USER_FOLDER_SIZE_LIMIT_BYTES: 10
    });

    await writeAppFile({
      content: "123456789012",
      path: "~/notes.txt",
      projectRoot,
      runtimeParams: unboundedRuntimeParams,
      username: "alice",
      watchdog: createWatchdog(projectRoot)
    });

    await assertQuotaReject(async () => {
      await writeAppFile({
        content: "abcdefghijkl",
        path: "~/notes.txt",
        projectRoot,
        runtimeParams: quotaRuntimeParams,
        username: "alice",
        watchdog: createWatchdog(projectRoot)
      });
    });

    await writeAppFile({
      content: "123456789",
      path: "~/notes.txt",
      projectRoot,
      runtimeParams: quotaRuntimeParams,
      username: "alice",
      watchdog: createWatchdog(projectRoot)
    });

    assert.equal(readUserFile(projectRoot, "alice", "notes.txt"), "123456789");
  }

  {
    const projectRoot = createProjectRoot();
    seedAlice(projectRoot, { "notes.txt": "x" });
    const unboundedRuntimeParams = createStaticRuntimeParams({
      USER_FOLDER_SIZE_LIMIT_BYTES: 0
    });
    const quotaRuntimeParams = createStaticRuntimeParams({
      USER_FOLDER_SIZE_LIMIT_BYTES: 10
    });

    await writeAppFile({
      content: "123456789012",
      path: "~/notes.txt",
      projectRoot,
      runtimeParams: unboundedRuntimeParams,
      username: "alice",
      watchdog: createWatchdog(projectRoot)
    });

    const result = await deleteAppPath({
      path: "~/notes.txt",
      projectRoot,
      runtimeParams: quotaRuntimeParams,
      username: "alice",
      watchdog: createWatchdog(projectRoot)
    });

    assert.deepEqual(result, {
      path: "L2/alice/notes.txt"
    });
    assert.equal(fs.existsSync(path.join(projectRoot, "app", "L2", "alice", "notes.txt")), false);
  }

  {
    const projectRoot = createProjectRoot();
    seedAlice(projectRoot, {});
    const runtimeParams = createStaticRuntimeParams({
      USER_FOLDER_SIZE_LIMIT_BYTES: 10
    });
    const watchdog = createWatchdog(projectRoot);

    await assertQuotaReject(async () => {
      await writeAppFiles({
        files: [
          {
            content: "123456",
            path: "~/a.txt"
          },
          {
            content: "12345",
            path: "~/b.txt"
          }
        ],
        projectRoot,
        runtimeParams,
        username: "alice",
        watchdog
      });
    });

    assert.equal(fs.existsSync(path.join(projectRoot, "app", "L2", "alice", "a.txt")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "app", "L2", "alice", "b.txt")), false);
  }

  {
    const projectRoot = createProjectRoot();
    seedAlice(projectRoot, { "a.txt": "" });
    const runtimeParams = createStaticRuntimeParams({
      USER_FOLDER_SIZE_LIMIT_BYTES: 10
    });

    await writeAppFile({
      content: "123456",
      path: "~/a.txt",
      projectRoot,
      runtimeParams,
      username: "alice",
      watchdog: createWatchdog(projectRoot)
    });
    await assertQuotaReject(async () => {
      await writeAppFile({
        content: "12345",
        path: "~/b.txt",
        projectRoot,
        runtimeParams,
        username: "alice",
        watchdog: createWatchdog(projectRoot)
      });
    });

    await writeAppFile({
      content: "123",
      path: "~/a.txt",
      projectRoot,
      runtimeParams,
      username: "alice",
      watchdog: createWatchdog(projectRoot)
    });
    await writeAppFile({
      content: "1234567",
      path: "~/b.txt",
      projectRoot,
      runtimeParams,
      username: "alice",
      watchdog: createWatchdog(projectRoot)
    });

    assert.equal(readUserFile(projectRoot, "alice", "a.txt"), "123");
    assert.equal(readUserFile(projectRoot, "alice", "b.txt"), "1234567");
  }

  {
    const projectRoot = createProjectRoot();
    seedAlice(projectRoot, { "source.txt": "" });
    const runtimeParams = createStaticRuntimeParams({
      USER_FOLDER_SIZE_LIMIT_BYTES: 10
    });

    await writeAppFile({
      content: "123456",
      path: "~/source.txt",
      projectRoot,
      runtimeParams,
      username: "alice",
      watchdog: createWatchdog(projectRoot)
    });

    await assertQuotaReject(async () => {
      await copyAppPath({
        fromPath: "~/source.txt",
        projectRoot,
        runtimeParams,
        toPath: "~/copy.txt",
        username: "alice",
        watchdog: createWatchdog(projectRoot)
      });
    });
    assert.equal(fs.existsSync(path.join(projectRoot, "app", "L2", "alice", "copy.txt")), false);
  }

  {
    const projectRoot = createProjectRoot();
    seedAlice(projectRoot, {});
    fs.mkdirSync(path.join(projectRoot, "app", "L2", "alice", "nested"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "app", "L2", "alice", "nested", "a.txt"), "");
    fs.writeFileSync(path.join(projectRoot, "app", "L2", "alice", "nested", "b.txt"), "");

    const unboundedRuntimeParams = createStaticRuntimeParams({
      USER_FOLDER_SIZE_LIMIT_BYTES: 0
    });
    const quotaRuntimeParams = createStaticRuntimeParams({
      USER_FOLDER_SIZE_LIMIT_BYTES: 15
    });

    await writeAppFile({
      content: "12345",
      path: "~/nested/a.txt",
      projectRoot,
      runtimeParams: unboundedRuntimeParams,
      username: "alice",
      watchdog: createWatchdog(projectRoot)
    });
    await writeAppFile({
      content: "1234",
      path: "~/nested/b.txt",
      projectRoot,
      runtimeParams: unboundedRuntimeParams,
      username: "alice",
      watchdog: createWatchdog(projectRoot)
    });

    const watchdog = createWatchdog(projectRoot);
    const originalLstatSync = fs.lstatSync;
    const originalReaddirSync = fs.readdirSync;

    fs.lstatSync = () => {
      throw new Error("disk quota crawl is not allowed");
    };
    fs.readdirSync = () => {
      throw new Error("disk quota crawl is not allowed");
    };

    try {
      await assertQuotaReject(async () => {
        await copyAppPath({
          fromPath: "~/nested/",
          projectRoot,
          runtimeParams: quotaRuntimeParams,
          toPath: "~/copy/",
          username: "alice",
          watchdog
        });
      });
    } finally {
      fs.lstatSync = originalLstatSync;
      fs.readdirSync = originalReaddirSync;
    }

    assert.equal(fs.existsSync(path.join(projectRoot, "app", "L2", "alice", "copy")), false);
  }
}

await main();
