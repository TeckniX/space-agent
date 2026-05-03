import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

const clients = new Map();

function normalizeText(runtimeParams, key, envKey) {
  const fromParams =
    runtimeParams && typeof runtimeParams.get === "function"
      ? String(runtimeParams.get(key, "") || "").trim()
      : "";
  return fromParams || String(process.env[envKey] || "").trim();
}

function isObjectStorageConfigured(runtimeParams) {
  const endpoint = normalizeText(runtimeParams, "OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_ENDPOINT");
  const bucket = normalizeText(runtimeParams, "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_BUCKET");
  const accessKey = normalizeText(
    runtimeParams,
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_ACCESS_KEY"
  );
  const secretKey = normalizeText(
    runtimeParams,
    "OBJECT_STORAGE_SECRET_KEY",
    "OBJECT_STORAGE_SECRET_KEY"
  );
  return Boolean(endpoint && bucket && accessKey && secretKey);
}

function getObjectStorageConfig(runtimeParams) {
  const endpoint = normalizeText(runtimeParams, "OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_ENDPOINT");
  const bucket = normalizeText(runtimeParams, "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_BUCKET");
  const accessKey = normalizeText(
    runtimeParams,
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_ACCESS_KEY"
  );
  const secretKey = normalizeText(
    runtimeParams,
    "OBJECT_STORAGE_SECRET_KEY",
    "OBJECT_STORAGE_SECRET_KEY"
  );
  const region = normalizeText(runtimeParams, "OBJECT_STORAGE_REGION", "OBJECT_STORAGE_REGION") || "us-east-1";
  const usePathStyle =
    String(
      runtimeParams && typeof runtimeParams.get === "function"
        ? runtimeParams.get("OBJECT_STORAGE_USE_PATH_STYLE", "true")
        : process.env.OBJECT_STORAGE_USE_PATH_STYLE || "true"
    ).toLowerCase() !== "false";

  return {
    accessKey,
    bucket,
    endpoint,
    region,
    secretKey,
    usePathStyle
  };
}

function getS3Client(runtimeParams) {
  const config = getObjectStorageConfig(runtimeParams);
  const cacheKey = `${config.endpoint}|${config.region}|${config.accessKey}|${String(config.usePathStyle)}`;

  if (!clients.has(cacheKey)) {
    clients.set(
      cacheKey,
      new S3Client({
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey
        },
        endpoint: config.endpoint,
        forcePathStyle: config.usePathStyle,
        region: config.region
      })
    );
  }

  return { client: clients.get(cacheKey), config };
}

async function ensureObjectStorageBucketIfConfigured(runtimeParams) {
  if (!isObjectStorageConfigured(runtimeParams)) {
    return;
  }

  const { client, config } = getS3Client(runtimeParams);

  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  }
}

async function putObjectBytes(runtimeParams, key, body, contentType = "application/octet-stream") {
  const { client, config } = getS3Client(runtimeParams);
  await client.send(
    new PutObjectCommand({
      Body: body,
      Bucket: config.bucket,
      ContentType: contentType,
      Key: key
    })
  );
}

async function getObjectBytes(runtimeParams, key) {
  const { client, config } = getS3Client(runtimeParams);
  const result = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key
    })
  );
  return Buffer.from(await result.Body.transformToByteArray());
}

async function headObject(runtimeParams, key) {
  const { client, config } = getS3Client(runtimeParams);
  return client.send(
    new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key
    })
  );
}

async function deleteObjectKey(runtimeParams, key) {
  const { client, config } = getS3Client(runtimeParams);
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key
    })
  );
}

async function listObjectMetadata(runtimeParams, prefix) {
  const { client, config } = getS3Client(runtimeParams);
  const objects = [];
  let continuationToken;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        ContinuationToken: continuationToken,
        Prefix: prefix
      })
    );

    for (const item of page.Contents || []) {
      if (item.Key) {
        objects.push({
          key: item.Key,
          lastModified: item.LastModified ? item.LastModified.getTime() : 0,
          sizeBytes: Number(item.Size) || 0
        });
      }
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

export {
  deleteObjectKey,
  ensureObjectStorageBucketIfConfigured,
  getObjectBytes,
  getObjectStorageConfig,
  getS3Client,
  headObject,
  isObjectStorageConfigured,
  listObjectMetadata,
  putObjectBytes
};
