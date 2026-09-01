/** Expandable as `$NAME` in a POSIX shell */
const SHELL_SAFE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Dashes are allowed, which is why steps.setup-node.outputs.node-version works.
/** Usable as a bare property in an Actions expression, e.g. steps.x.outputs.NAME */
const EXPR_SAFE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// @actions/core guards the value and its own delimiter, but not the name, so a
// name containing these would corrupt the file and could inject a variable.
/** Characters that would corrupt the $GITHUB_ENV / $GITHUB_OUTPUT heredoc format */
const STRUCTURALLY_UNSAFE = /[\r\n\0=]/;

/**
 * Classify a secret name by where it can be used
 * @param {string} name
 * @returns {{name: string, structurallyUnsafe: boolean, shellSafe: boolean, exprSafe: boolean}}
 */
export function classify(name) {
  const structurallyUnsafe = name === "" || STRUCTURALLY_UNSAFE.test(name);
  return {
    name,
    structurallyUnsafe,
    shellSafe: !structurallyUnsafe && SHELL_SAFE.test(name),
    exprSafe: !structurallyUnsafe && EXPR_SAFE.test(name),
  };
}

/**
 * Key for detecting names that collide once case is folded. Environment variables
 * are case-insensitive on Windows, so api_key and API_KEY are one variable there.
 * @param {string} name
 * @returns {string}
 */
export function collisionKey(name) {
  return name.toUpperCase();
}
