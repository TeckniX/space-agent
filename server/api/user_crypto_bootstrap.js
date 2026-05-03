import {
  buildClientUserCryptoRecord,
  createUserCryptoServerShare,
  getUserCryptoState,
  provisionUserCrypto,
  readUserCryptoServerShare,
  USER_CRYPTO_STATUS_READY
} from "../lib/auth/user_crypto.js";
import { runTrackedMutation } from "../runtime/request_mutations.js";

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

async function buildUserCryptoPayload(context, username) {
  const userCryptoState = await getUserCryptoState(context.projectRoot, username, context.runtimeParams);

  return {
    keyId: userCryptoState.keyId,
    record: buildClientUserCryptoRecord(userCryptoState.record),
    serverShare:
      userCryptoState.status === USER_CRYPTO_STATUS_READY
        ? await readUserCryptoServerShare(context.projectRoot, username, {
            record: userCryptoState.record,
            runtimeParams: context.runtimeParams
          })
        : "",
    state: userCryptoState.status
  };
}

export async function post(context) {
  const username = String(context.user?.username || "").trim();

  if (!username) {
    throw createHttpError("Authentication is required.", 401);
  }

  const payload = readPayload(context);
  const currentPayload = await buildUserCryptoPayload(context, username);

  if (currentPayload.state !== "missing") {
    return currentPayload;
  }

  const record =
    payload.record && typeof payload.record === "object" && !Array.isArray(payload.record)
      ? payload.record
      : null;

  if (!record) {
    return {
      ...currentPayload,
      provisioningShare: createUserCryptoServerShare()
    };
  }

  const provisioningShare = String(payload.provisioningShare || "").trim();

  if (!provisioningShare) {
    throw createHttpError("A provisioning share is required to bootstrap user crypto.", 400);
  }

  await runTrackedMutation(context, async () =>
    provisionUserCrypto(context.projectRoot, username, {
      record,
      runtimeParams: context.runtimeParams,
      serverShare: provisioningShare
    })
  );

  return buildUserCryptoPayload(context, username);
}
