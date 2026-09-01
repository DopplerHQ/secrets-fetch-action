import * as core from "@actions/core";
import { fetch, oidcAuth } from "./doppler.js";
import {
  DEFAULT_INVALID_NAME_POLICY,
  INVALID_NAME_POLICIES,
  processSecrets,
  reportProblems,
} from "./secrets.js";

// For local testing
if (process.env.NODE_ENV === "development" && process.env.DOPPLER_TOKEN) {
  process.env["INPUT_AUTH-METHOD"] = "token";
  process.env["INPUT_DOPPLER-API-DOMAIN"] = "api.doppler.com";
  process.env["INPUT_DOPPLER-TOKEN"] = process.env.DOPPLER_TOKEN;
  process.env["INPUT_DOPPLER-PROJECT"] = process.env.DOPPLER_PROJECT;
  process.env["INPUT_DOPPLER-CONFIG"] = process.env.DOPPLER_CONFIG;
}

const AUTH_METHOD = core.getInput("auth-method");
const API_DOMAIN = core.getInput("doppler-api-domain");
let DOPPLER_TOKEN = "";

if (AUTH_METHOD === "oidc") {
  const DOPPLER_IDENTITY_ID = core.getInput("doppler-identity-id", { required: true });
  const oidcToken = await core.getIDToken();
  core.setSecret(oidcToken);
  DOPPLER_TOKEN = await oidcAuth(DOPPLER_IDENTITY_ID, oidcToken, API_DOMAIN);
} else if (AUTH_METHOD === "token") {
  DOPPLER_TOKEN = core.getInput("doppler-token", { required: true });
} else {
  core.setFailed("Unsupported auth-method");
  process.exit();
}

core.setSecret(DOPPLER_TOKEN);

const ON_INVALID_NAME = core.getInput("on-invalid-name") || DEFAULT_INVALID_NAME_POLICY;
if (!INVALID_NAME_POLICIES.includes(ON_INVALID_NAME)) {
  core.setFailed(`Unsupported on-invalid-name '${ON_INVALID_NAME}'. Valid options are ${INVALID_NAME_POLICIES.join(", ")}`);
  process.exit();
}

const IS_SA_TOKEN = DOPPLER_TOKEN.startsWith("dp.sa.") || DOPPLER_TOKEN.startsWith("dp.said.");
const IS_PERSONAL_TOKEN = DOPPLER_TOKEN.startsWith("dp.pt.");
const DOPPLER_PROJECT = (IS_SA_TOKEN || IS_PERSONAL_TOKEN) ? core.getInput("doppler-project") : null;
const DOPPLER_CONFIG = (IS_SA_TOKEN || IS_PERSONAL_TOKEN) ? core.getInput("doppler-config") : null;
if (IS_PERSONAL_TOKEN && !(DOPPLER_PROJECT && DOPPLER_CONFIG)) {
  core.setFailed("doppler-project and doppler-config inputs are required when using a Personal token. Additionally, we recommend switching to Service Accounts.");
  process.exit();
}
if (IS_SA_TOKEN && !(DOPPLER_PROJECT && DOPPLER_CONFIG)) {
  core.setFailed("doppler-project and doppler-config inputs are required when using a Service Account token");
  process.exit();
}

const secrets = await fetch(DOPPLER_TOKEN, DOPPLER_PROJECT, DOPPLER_CONFIG, API_DOMAIN);

// Pass individual functions, not the core namespace; letting the namespace escape
// into a call defeats tree-shaking and pulls all of @actions/core into the bundle
const sink = {
  setOutput: core.setOutput,
  exportVariable: core.exportVariable,
  setSecret: core.setSecret,
  setFailed: core.setFailed,
  warning: core.warning,
  error: core.error,
  startGroup: core.startGroup,
  endGroup: core.endGroup,
};

const problems = processSecrets(secrets, {
  core: sink,
  injectEnvVars: core.getInput("inject-env-vars") === "true",
  onInvalidName: ON_INVALID_NAME,
});

reportProblems(problems, { core: sink, onInvalidName: ON_INVALID_NAME, platform: process.platform });
