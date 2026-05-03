import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeAppFile } from "../server/lib/customware/file_access.js";

function createStaticRuntimeParams(values = {}) {
  return {
    get(name, fallback = undefined) {
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : fallback;
    }
  };
}

function createPathIndexWatchdog(projectRoot) {
  const paths = Object.create(null);
  const notesPath = "/app/L2/alice/notes.txt";
  const userDir = "/app/L2/alice/";
  paths[userDir] = { isDirectory: true, mtimeMs: 0, sizeBytes: 0 };
  paths[notesPath] = { isDirectory: false, mtimeMs: Date.now(), sizeBytes: 0 };

  return {
    getIndex(name) {
      if (name === "path_index") {
        return paths;
      }

      return null;
    },
    getPaths() {
      return Object.keys(paths).sort((left, right) => left.localeCompare(right));
    }
  };
}

function createWriteOptions(projectRoot, overrides = {}) {
  return {
    projectRoot,
    runtimeParams: createStaticRuntimeParams({ USER_FOLDER_SIZE_LIMIT_BYTES: 0 }),
    username: "alice",
    watchdog: createPathIndexWatchdog(projectRoot),
    ...overrides
  };
}

async function readUserFile(projectRoot, relativePath) {
  return readFile(path.join(projectRoot, "app", "L2", "alice", relativePath), "utf8");
}

test("writeAppFile supports append, prepend, and insert operations", async (testContext) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "space-file-write-"));
  await mkdir(path.join(projectRoot, "app", "L2", "alice"), { recursive: true });
  await writeFile(path.join(projectRoot, "app", "L2", "alice", "notes.txt"), "", "utf8");

  testContext.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  await writeAppFile({
    ...createWriteOptions(projectRoot),
    content: "two\n",
    operation: "append",
    path: "~/notes.txt"
  });
  assert.equal(await readUserFile(projectRoot, "notes.txt"), "two\n");

  await writeAppFile({
    ...createWriteOptions(projectRoot),
    content: "three\n",
    operation: "append",
    path: "~/notes.txt"
  });
  assert.equal(await readUserFile(projectRoot, "notes.txt"), "two\nthree\n");

  await writeAppFile({
    ...createWriteOptions(projectRoot),
    content: "one\n",
    operation: "prepend",
    path: "~/notes.txt"
  });
  assert.equal(await readUserFile(projectRoot, "notes.txt"), "one\ntwo\nthree\n");

  await writeAppFile({
    ...createWriteOptions(projectRoot),
    content: "one-point-five\n",
    line: 2,
    operation: "insert",
    path: "~/notes.txt"
  });
  assert.equal(await readUserFile(projectRoot, "notes.txt"), "one\none-point-five\ntwo\nthree\n");

  await writeAppFile({
    ...createWriteOptions(projectRoot),
    after: "two\n",
    content: "two-point-five\n",
    operation: "insert",
    path: "~/notes.txt"
  });
  assert.equal(
    await readUserFile(projectRoot, "notes.txt"),
    "one\none-point-five\ntwo\ntwo-point-five\nthree\n"
  );

  await writeAppFile({
    ...createWriteOptions(projectRoot),
    before: "three\n",
    content: "before-three\n",
    operation: "insert",
    path: "~/notes.txt"
  });
  assert.equal(
    await readUserFile(projectRoot, "notes.txt"),
    "one\none-point-five\ntwo\ntwo-point-five\nbefore-three\nthree\n"
  );
});

test("writeAppFile rejects invalid insert anchors and encodings", async (testContext) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "space-file-write-"));
  await mkdir(path.join(projectRoot, "app", "L2", "alice"), { recursive: true });
  await writeFile(path.join(projectRoot, "app", "L2", "alice", "notes.txt"), "", "utf8");

  testContext.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  await writeAppFile({
    ...createWriteOptions(projectRoot),
    content: "alpha\nbeta\n",
    path: "~/notes.txt"
  });

  await assert.rejects(
    async () => {
      await writeAppFile({
        ...createWriteOptions(projectRoot),
        content: "gamma\n",
        operation: "insert",
        path: "~/notes.txt"
      });
    },
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /exactly one of line, before, or after/u);
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await writeAppFile({
        ...createWriteOptions(projectRoot),
        before: "missing",
        content: "gamma\n",
        operation: "insert",
        path: "~/notes.txt"
      });
    },
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.match(error.message, /Insert pattern not found/u);
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await writeAppFile({
        ...createWriteOptions(projectRoot),
        content: Buffer.from("gamma").toString("base64"),
        encoding: "base64",
        line: 1,
        operation: "insert",
        path: "~/notes.txt"
      });
    },
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /Insert writes require utf8 encoding/u);
      return true;
    }
  );
});
