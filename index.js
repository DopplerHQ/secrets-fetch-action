import core from "@actions/core";
import fetch from "./doppler.js";

// For local testing
if (process.env.NODE_ENV === "development" && process.env.DOPPLER_TOKEN) {
  process.env["INPUT_DOPPLER-TOKEN"] = process.env.DOPPLER_TOKEN;
  process.env["INPUT_DOPPLER-PROJECT"] = process.env.DOPPLER_PROJECT;
  process.env["INPUT_DOPPLER-CONFIG"] = process.env.DOPPLER_CONFIG;
}

const DOPPLER_META = ["DOPPLER_PROJECT", "DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT"];

const DOPPLER_TOKEN = core.getInput("doppler-token", { required: true });
core.setSecret(DOPPLER_TOKEN);

// Project and Config are required if a Personal token supplied
const IS_PERSONAL_TOKEN = DOPPLER_TOKEN.startsWith("dp.pt.");
if (IS_PERSONAL_TOKEN) {
  console.log("[info]: Personal token detected. doppler-project and doppler-config inputs are now required.");
}
const DOPPLER_PROJECT = IS_PERSONAL_TOKEN ? core.getInput("doppler-project", { required: true }) : null;
const DOPPLER_CONFIG = IS_PERSONAL_TOKEN ? core.getInput("doppler-config", { required: true }) : null;

const secrets = await fetch(DOPPLER_TOKEN, DOPPLER_PROJECT, DOPPLER_CONFIG);

for (const [key, value] of Object.entries(secrets)) {
  core.setOutput(key, value);
  if (!DOPPLER_META.includes(key)) {
    core.setSecret(value);
  }

  if (core.getInput("inject-env-vars") === "true") {
    core.exportVariable(key, value);
  }
}
