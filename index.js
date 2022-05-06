import core from "@actions/core";
import fetch from "./doppler.js";

// For local testing
if (process.env.NODE_ENV === "development" && process.env.DOPPLER_TOKEN) {
  process.env["INPUT_DOPPLER-TOKEN"] = process.env.DOPPLER_TOKEN;
}

const DOPPLER_META = [
  "DOPPLER_PROJECT",
  "DOPPLER_CONFIG",
  "DOPPLER_ENVIRONMENT",
];

const DOPPLER_TOKEN = core.getInput("doppler-token", { required: true });
core.setSecret(DOPPLER_TOKEN);

const secrets = await fetch(DOPPLER_TOKEN);

for (const [key, value] of Object.entries(secrets)) {
  core.setOutput(key, value);
  if (!DOPPLER_META.includes(key)) {
    core.setSecret(value);
  }
}
