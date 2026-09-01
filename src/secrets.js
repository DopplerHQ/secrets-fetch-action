import { classify, collisionKey } from "./names.js";

// Matched case-sensitively on purpose: a user-created `doppler_project` is an
// ordinary secret and must still be masked.
/** Server-injected metadata, which is not masked */
export const DOPPLER_META = ["DOPPLER_PROJECT", "DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT"];

export const INVALID_NAME_POLICIES = ["warn", "error", "skip"];
export const DEFAULT_INVALID_NAME_POLICY = "warn";

/**
 * @typedef {Object} Problem
 * @property {string} name
 * @property {"structural"|"shell"|"expr"|"collision"} kind
 * @property {string} [other] for collisions, the name already holding the slot
 */

/**
 * Determines if a name problem should fail the step. Structural problems always do,
 * since the secret is unreachable either way, and collisions do on Windows only.
 * @param {Problem} problem
 * @param {{onInvalidName: string, platform: string}} options
 * @returns {boolean}
 */
export function isFatal(problem, { onInvalidName, platform }) {
  if (problem.kind === "structural") return true;
  if (problem.kind === "collision" && platform === "win32") return true;
  return onInvalidName === "error";
}

/**
 * Write secrets to the outputs, mask register, and optionally the environment,
 * collecting any name usability problems along the way
 * @param {Record<string, {computed?: string, computedVisibility?: string}>} secrets
 * @param {Object} options
 * @param {any} options.core the @actions/core functions, injected for testability
 * @param {boolean} [options.injectEnvVars]
 * @param {string} [options.onInvalidName]
 * @returns {Problem[]}
 */
export function processSecrets(secrets, { core, injectEnvVars = false, onInvalidName = DEFAULT_INVALID_NAME_POLICY }) {
  const problems = [];
  const envSeen = new Map();
  const skip = onInvalidName === "skip";

  for (const [name, secret] of Object.entries(secrets)) {
    const value = secret?.computed || "";
    const classification = classify(name);

    // Mask before writing anywhere; without GITHUB_OUTPUT, setOutput falls back to
    // the ::set-output stdout command, which would echo an unmasked value
    if (!DOPPLER_META.includes(name) && secret?.computedVisibility !== "unmasked") {
      core.setSecret(value);
    }

    // Never handed to a file command, whatever the policy; still masked above
    if (classification.structurallyUnsafe) {
      problems.push({ name, kind: "structural" });
      continue;
    }

    if (classification.exprSafe || !skip) {
      core.setOutput(name, value);
    }
    if (!classification.exprSafe) {
      problems.push({ name, kind: "expr" });
    }

    if (!injectEnvVars) continue;

    const folded = collisionKey(name);
    const collidesWith = envSeen.get(folded);
    if (collidesWith !== undefined && collidesWith !== name) {
      problems.push({ name, kind: "collision", other: collidesWith });
      if (skip) continue;
    }
    envSeen.set(folded, name);

    if (classification.shellSafe || !skip) {
      core.exportVariable(name, value);
    }
    if (!classification.shellSafe) {
      problems.push({ name, kind: "shell" });
    }
  }

  return problems;
}

/**
 * Render a name list for a log message, capped so a config full of
 * non-conforming names does not bury the rest of the log
 * @param {string[]} names
 * @param {number} [max]
 * @returns {string}
 */
function formatNames(names, max = 10) {
  const shown = names.slice(0, max).map((name) => `'${name}'`).join(", ");
  const remaining = names.length - max;
  return remaining > 0 ? `${shown} (+${remaining} more)` : shown;
}

/**
 * Render a list of colliding pairs, capped the same way as a name list
 * @param {Problem[]} group
 * @param {number} [max]
 * @returns {string}
 */
function formatPairs(group, max = 10) {
  const shown = group
    .slice(0, max)
    .map((problem) => `'${problem.name}' vs '${problem.other}'`)
    .join(", ");
  const remaining = group.length - max;
  return remaining > 0 ? `${shown} (+${remaining} more)` : shown;
}

/**
 * Build the log message for one group of same-kind problems
 * @param {string} kind
 * @param {Problem[]} group
 * @param {boolean} skipped whether the configured policy suppressed the write
 * @returns {string}
 */
function formatMessage(kind, group, skipped) {
  const count = group.length;
  const isOne = count === 1;
  const plural = isOne ? "" : "s";
  const names = formatNames(group.map((problem) => problem.name));

  switch (kind) {
    case "structural":
      return (
        `${count} secret name${plural} ${isOne ? "contains" : "contain"} characters that cannot be ` +
        `written to $GITHUB_ENV or $GITHUB_OUTPUT (newline, carriage return, null byte, or '=') ` +
        `and ${isOne ? "was" : "were"} skipped: ${names}. The value${plural} ${isOne ? "is" : "are"} ` +
        `still masked in logs.`
      );
    case "shell":
      return (
        `${count} secret name${plural} cannot be referenced as $NAME in a shell step` +
        `${skipped ? ` and so ${isOne ? "was" : "were"} not exported` : ""}: ${names}. ` +
        `Note that $MY-SECRET expands to the empty $MY followed by the literal '-SECRET' ` +
        `rather than failing. Read ${isOne ? "it" : "these"} with printenv 'NAME' or \${{ env['NAME'] }}.`
      );
    case "expr":
      return (
        `${count} step output${plural} ${isOne ? "needs" : "need"} index syntax to read` +
        `${skipped ? ` and so ${isOne ? "was" : "were"} not set` : ""}: ${names}. ` +
        `Use \${{ steps.<step-id>.outputs['NAME'] }} rather than .NAME.`
      );
    case "collision":
      return (
        `${count} secret name${plural} ${isOne ? "differs" : "differ"} from another only by case. ` +
        `Environment variables are case-insensitive on Windows runners, so one silently ` +
        `overwrites the other there: ${formatPairs(group)}.`
      );
    default:
      return `${count} secret name${plural}: ${names}`;
  }
}

/**
 * Emit one grouped message per problem kind, then fail the step if any problem
 * is fatal under the configured policy
 * @param {Problem[]} problems
 * @param {{core: any, onInvalidName: string, platform: string}} options
 * @returns {boolean} whether the step was failed
 */
export function reportProblems(problems, { core, onInvalidName, platform }) {
  if (problems.length === 0) return false;

  const byKind = new Map();
  for (const problem of problems) {
    const group = byKind.get(problem.kind);
    if (group) group.push(problem);
    else byKind.set(problem.kind, [problem]);
  }

  const fatal = problems.filter((problem) => isFatal(problem, { onInvalidName, platform }));
  const skipped = onInvalidName === "skip";

  core.startGroup("Doppler: secret name compatibility");
  for (const [kind, group] of byKind) {
    const message = formatMessage(kind, group, skipped);
    const isKindFatal = group.some((problem) => isFatal(problem, { onInvalidName, platform }));
    if (isKindFatal) core.error(message);
    else core.warning(message);
  }
  core.endGroup();

  if (fatal.length > 0) {
    core.setFailed(
      `${fatal.length} secret name${fatal.length === 1 ? "" : "s"} cannot be used as requested. ` +
        `See the "Doppler: secret name compatibility" group above for details.`,
    );
    return true;
  }

  return false;
}
