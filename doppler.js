import https from "https";
import { VERSION } from "./meta.js";

/**
 * Fetch secrets from Doppler the API
 * @param {string} dopplerToken
 * @param {string | null} [dopplerProject]
 * @param {string | null} [dopplerConfig]
 * @returns {() => Promise<Record<string, string>>}
 */
async function fetch(dopplerToken, dopplerProject, dopplerConfig) {
  return new Promise(function (resolve, reject) {
    const encodedAuthData = Buffer.from(`${dopplerToken}:`).toString("base64");
    const authHeader = `Basic ${encodedAuthData}`;
    const userAgent = `secrets-fetch-github-action/${VERSION}`;

    const url = new URL("https://api.doppler.com/v3/configs/config/secrets/download?format=json");
    if (dopplerProject && dopplerConfig) {
      url.searchParams.append("project", dopplerProject);
      url.searchParams.append("config", dopplerConfig);
    }

    https
      .get(
        url.href,
        {
          headers: {
            Authorization: authHeader,
            "user-agent": userAgent,
          },
        },
        (res) => {
          let payload = "";
          res.on("data", (data) => (payload += data));
          res.on("end", () => {
            if (res.statusCode === 200) {
              resolve(JSON.parse(payload));
            } else {
              try {
                const error = JSON.parse(payload).messages.join(" ");
                reject(new Error(`Doppler API Error: ${error}`));
              } catch (error) {
                // In the event an upstream issue occurs and no JSON payload is supplied
                reject(new Error(`Doppler API Error: ${res.statusCode} ${res.statusMessage}`));
              }
            }
          });
        }
      )
      .on("error", (error) => {
        reject(new Error(`Doppler API Error: ${error}`));
      });
  });
}

export default fetch;
