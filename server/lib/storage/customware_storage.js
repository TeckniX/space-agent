import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";

import { normalizeAppProjectPath } from "../customware/layout.js";
import { deleteObjectKey, getS3Client, isObjectStorageConfigured, listObjectMetadata } from "./object_storage.js";

const AUTH_L2_PATH =
  /^\/app\/L2\/[^/]+\/(?:user\.yaml|meta\/(?:password\.json|logins\.json|user_crypto\.json))$/u;

function projectPathToKey(projectPath) {
  const isDirectory = String(projectPath || "").endsWith("/");
  const normalized = normalizeAppProjectPath(projectPath, {
    allowAppRoot: false,
    isDirectory
  });

  if (!normalized || !normalized.startsWith("/app/")) {
    return "";
  }

  let relative = normalized.slice("/app/".length);
  if (isDirectory && relative && !relative.endsWith("/")) {
    relative += "/";
  }

  return relative.replace(/^\/+/u, "");
}

export function isObjectBackedWritableAppPath(projectPath, runtimeParams) {
  if (!isObjectStorageConfigured(runtimeParams)) {
    return false;
  }

  const base = stripDirectorySuffix(
    normalizeAppProjectPath(projectPath, {
      allowAppRoot: false,
      isDirectory: false
    })
  );

  if (!base || AUTH_L2_PATH.test(base)) {
    return false;
  }

  return base.startsWith("/app/L1/") || base.startsWith("/app/L2/");
}

function stripDirectorySuffix(projectPath) {
  const text = String(projectPath || "");
  return text.endsWith("/") ? text.slice(0, -1) : text;
}

export async function readWritableLayerObject(projectRoot, projectPath, runtimeParams) {
  void projectRoot;
  const { client, config } = getS3Client(runtimeParams);
  const key = projectPathToKey(projectPath);

  if (!key || key.endsWith("/")) {
    return null;
  }

  const result = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key
    })
  );

  return Buffer.from(await result.Body.transformToByteArray());
}

export async function writeWritableLayerObject(projectRoot, projectPath, runtimeParams, buffer) {
  void projectRoot;
  const { client, config } = getS3Client(runtimeParams);
  const key = projectPathToKey(projectPath);

  if (!key) {
    throw new Error("Invalid object storage path.");
  }

  await client.send(
    new PutObjectCommand({
      Body: buffer,
      Bucket: config.bucket,
      Key: key
    })
  );
}

export async function writeWritableLayerDirectoryMarker(projectRoot, projectPath, runtimeParams) {
  void projectRoot;
  const { client, config } = getS3Client(runtimeParams);
  const key = projectPathToKey(projectPath.endsWith("/") ? projectPath : `${projectPath}/`);

  if (!key) {
    throw new Error("Invalid object storage path.");
  }

  await client.send(
    new PutObjectCommand({
      Body: Buffer.alloc(0),
      Bucket: config.bucket,
      Key: key
    })
  );
}

export async function deleteWritableLayerTree(runtimeParams, projectPathPrefix) {
  const baseKey = projectPathToKey(projectPathPrefix.endsWith("/") ? projectPathPrefix : `${projectPathPrefix}/`);

  if (!baseKey) {
    return;
  }

  const keys = await listObjectMetadata(runtimeParams, baseKey);

  for (const { key } of keys) {
    await deleteObjectKey(runtimeParams, key);
  }
}

export async function copyWritableLayerObject(runtimeParams, sourceProjectPath, destinationProjectPath) {
  const { client, config } = getS3Client(runtimeParams);
  const sourceKey = projectPathToKey(sourceProjectPath);
  const destKey = projectPathToKey(destinationProjectPath);

  if (!sourceKey || !destKey || sourceKey.endsWith("/") || destKey.endsWith("/")) {
    throw new Error("Invalid object storage copy path.");
  }

  await client.send(
    new CopyObjectCommand({
      Bucket: config.bucket,
      CopySource: `${config.bucket}/${sourceKey}`,
      Key: destKey
    })
  );
}

export async function deleteWritableLayerObject(runtimeParams, projectPath) {
  const { client, config } = getS3Client(runtimeParams);
  const key = projectPathToKey(projectPath);

  if (!key || key.endsWith("/")) {
    return;
  }

  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key
    })
  );
}

export async function statWritableLayerObject(runtimeParams, projectPath) {
  const { headObject } = await import("./object_storage.js");
  const key = projectPathToKey(projectPath);

  if (!key) {
    return null;
  }

  try {
    const meta = await headObject(runtimeParams, key);
    return {
      isDirectory: false,
      mtimeMs: meta.LastModified ? meta.LastModified.getTime() : Date.now(),
      sizeBytes: Number(meta.ContentLength) || 0
    };
  } catch {
    return null;
  }
}
