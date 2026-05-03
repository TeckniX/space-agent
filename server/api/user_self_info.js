import { getRuntimeGroupIndex } from "../lib/customware/group_runtime.js";
import { getUserCryptoState } from "../lib/auth/user_crypto.js";

export async function get(context) {
  const username = String(context.user?.username || "").trim();
  const userIndex =
    context.watchdog && typeof context.watchdog.getIndex === "function"
      ? context.watchdog.getIndex("user_index")
      : null;
  const groupIndex = getRuntimeGroupIndex(context.watchdog, context.runtimeParams);
  const userRecord =
    userIndex && typeof userIndex.getUser === "function" ? userIndex.getUser(username) : null;
  const groups =
    groupIndex && typeof groupIndex.getOrderedGroupsForUser === "function"
      ? groupIndex.getOrderedGroupsForUser(username)
      : [];
  const managedGroups =
    groupIndex && typeof groupIndex.getManagedGroupsForUser === "function"
      ? groupIndex.getManagedGroupsForUser(username)
      : [];
  const userCryptoState = await getUserCryptoState(context.projectRoot, username, context.runtimeParams);
  return {
    fullName: String(userRecord?.fullName || username),
    groups: Array.isArray(groups) ? groups : [],
    managedGroups: Array.isArray(managedGroups) ? managedGroups : [],
    sessionId: String(context.user?.session?.sessionId || "").trim(),
    userCryptoKeyId: String(userCryptoState?.keyId || "").trim(),
    userCryptoState: String(userCryptoState?.status || "missing"),
    username
  };
}
