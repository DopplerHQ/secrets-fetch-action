import * as core from "@actions/core";
import { fetch, oidcAuth } from "./doppler.js";

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
const RETRY_OPTIONS = {
  // Fixed prefix on a single line, so an error message can't start a line with a workflow command
  onRetry: (error, attempt, delay) => core.info(`Attempt ${attempt} failed, retrying in ${(delay / 1000).toFixed(1)}s: ${String(error?.message ?? error).replace(/\s+/g, " ")}`),
};

if (AUTH_METHOD === "oidc") {
  const DOPPLER_IDENTITY_ID = core.getInput("doppler-identity-id", { required: true });
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    core.setFailed("auth-method \"oidc\" requires the `id-token: write` permission on the job or workflow");
    process.exit();
  }
  // Passed directly, since getIDToken() already masks each token it returns
  DOPPLER_TOKEN = await oidcAuth(DOPPLER_IDENTITY_ID, core.getIDToken, API_DOMAIN, RETRY_OPTIONS);
} else if (AUTH_METHOD === "token") {
  DOPPLER_TOKEN = core.getInput("doppler-token", { required: true });
} else {
  core.setFailed("Unsupported auth-method");
  process.exit();
}

const DOPPLER_META = ["DOPPLER_PROJECT", "DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT"];
core.setSecret(DOPPLER_TOKEN);

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

const secrets = await fetch(DOPPLER_TOKEN, DOPPLER_PROJECT, DOPPLER_CONFIG, API_DOMAIN, RETRY_OPTIONS);

for (const [key, secret] of Object.entries(secrets)) {
  const value = secret.computed || "";

  core.setOutput(key, value);
  if (!DOPPLER_META.includes(key) && secret.computedVisibility !== "unmasked") {
    core.setSecret(value);
  }

  if (core.getInput("inject-env-vars") === "true") {
    core.exportVariable(key, value);
  }
}
