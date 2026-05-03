import { createUser, setUserPassword } from "../server/lib/auth/user_manage.js";
import { addGroupEntry } from "../server/lib/customware/group_files.js";
import { flushGitHistoryCommits } from "../server/lib/customware/git_history.js";
import { normalizeEntityId } from "../server/lib/customware/layout.js";
import { createRuntimeParams } from "../server/lib/utils/runtime_params.js";

function takeFlagValue(args, index, flagName) {
  const value = String(args[index + 1] || "");

  if (!value) {
    throw new Error(`Missing value for ${flagName}.`);
  }

  return value;
}

function normalizeGroupList(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map((value) => normalizeEntityId(value))
    .filter(Boolean);
}

function parseCreateArgs(args) {
  const options = {
    force: false,
    fullName: "",
    groups: [],
    password: "",
    username: ""
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!options.username && !arg.startsWith("--")) {
      options.username = arg;
      continue;
    }

    if (arg === "--password") {
      options.password = takeFlagValue(args, index, "--password");
      index += 1;
      continue;
    }

    if (arg === "--full-name") {
      options.fullName = takeFlagValue(args, index, "--full-name");
      index += 1;
      continue;
    }

    if (arg === "--groups") {
      options.groups.push(...normalizeGroupList(takeFlagValue(args, index, "--groups")));
      index += 1;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    throw new Error(`Unknown user create argument: ${arg}`);
  }

  if (!options.username || !options.password) {
    throw new Error(
      "Usage: node space user create <username> --password <password> [--full-name <name>] [--groups <group[,group...]>] [--force]"
    );
  }

  options.groups = [...new Set(options.groups)].sort((left, right) => left.localeCompare(right));
  return options;
}

function parsePasswordArgs(args) {
  const options = {
    password: "",
    username: ""
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!options.username && !arg.startsWith("--")) {
      options.username = arg;
      continue;
    }

    if (arg === "--password") {
      options.password = takeFlagValue(args, index, "--password");
      index += 1;
      continue;
    }

    throw new Error(`Unknown user password argument: ${arg}`);
  }

  if (!options.username || !options.password) {
    throw new Error("Usage: node space user password <username> --password <password>");
  }

  return options;
}

export const help = {
  name: "user",
  summary: "Manage L2 users and passwords.",
  usage: [
    "node space user create <username> --password <password> [--full-name <name>] [--groups <group[,group...]>] [--force]",
    "node space user password <username> --password <password>"
  ],
  description:
    "Creates L2 users, stores user metadata in user.yaml, stores the password verifier in meta/password.json, and clears existing login sessions in meta/logins.json when the password changes. When CUSTOMWARE_PATH is configured the writable L2 tree lives under CUSTOMWARE_PATH/L2. User creation may also add the user to writable L1 groups.",
  arguments: [
    {
      name: "<username>",
      description: "User id under the logical L2/<username>/ root, stored under CUSTOMWARE_PATH/L2 when configured."
    }
  ],
  options: [
    {
      flag: "create",
      description: "Create a user directory with user.yaml, meta/password.json, meta/logins.json, and mod/."
    },
    {
      flag: "password",
      description: "Reset a user's password and clear existing sessions."
    },
    {
      flag: "--full-name <name>",
      description: "Full name written to user.yaml. Defaults to the user id."
    },
    {
      flag: "--password <password>",
      description: "Password used for create or password subcommands."
    },
    {
      flag: "--groups <group[,group...]>",
      description: "Comma-separated groups to add during user creation. Missing writable L1 groups are created automatically."
    },
    {
      flag: "--force",
      description: "Replace the full user directory during create."
    }
  ],
  examples: [
    "node space user create alice --password secret123",
    "node space user create alice --password secret123 --full-name \"Alice Example\"",
    "node space user create alice --password secret123 --groups _admin,team-red",
    "node space user password alice --password newsecret456"
  ]
};

export async function execute(context) {
  const subcommand = String(context.args[0] || "").trim().toLowerCase();
  const subcommandArgs = context.args.slice(1);
  const runtimeParams = await createRuntimeParams(context.projectRoot, {
    env: context.originalEnv
  });

  if (subcommand === "create") {
    const options = parseCreateArgs(subcommandArgs);
    const result = await createUser(context.projectRoot, options.username, options.password, {
      force: options.force,
      fullName: options.fullName,
      runtimeParams
    });
    for (const groupId of options.groups) {
      addGroupEntry(context.projectRoot, groupId, "user", result.username, {
        runtimeParams
      });
    }
    await flushGitHistoryCommits({ throwOnError: true });
    const groupSummary = options.groups.length ? ` and added to ${options.groups.join(", ")}` : "";
    console.log(`Created user ${result.username}${groupSummary}`);
    return 0;
  }

  if (subcommand === "password" || subcommand === "passwd") {
    const options = parsePasswordArgs(subcommandArgs);
    const result = await setUserPassword(context.projectRoot, options.username, options.password, {
      runtimeParams
    });
    await flushGitHistoryCommits({ throwOnError: true });
    console.log(`Updated password for ${result.username}`);
    return 0;
  }

  throw new Error(
    'Unknown user subcommand. Use "node space help user" for available subcommands.'
  );
}
