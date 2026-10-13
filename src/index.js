import * as core from "@actions/core";
import { fetch, oidcAuth, withRetry } from "./doppler.js";

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
  // Missing request env vars are a permissions problem, not a transient one, so fail before retrying
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    core.setFailed("Unable to request a GitHub OIDC token. The job or workflow requires the `id-token: write` permission when auth-method is \"oidc\".");
    process.exit();
  }
  // getIDToken() only retries 502/503/504 and only exposes the status code in its message, so retry everything except 4xx
  const getOidcToken = () => withRetry(() => core.getIDToken(), {
    isRetryable: (error) => !/Error Code : 4\d\d/.test(error?.message),
  });
  DOPPLER_TOKEN = await oidcAuth(DOPPLER_IDENTITY_ID, getOidcToken, API_DOMAIN);
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

const secrets = await fetch(DOPPLER_TOKEN, DOPPLER_PROJECT, DOPPLER_CONFIG, API_DOMAIN);

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
