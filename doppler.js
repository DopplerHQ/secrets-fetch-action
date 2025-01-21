import https from "https";
import { VERSION } from "./meta.js";

/**
 * Fetch secrets from Doppler the API
 * @param {string} dopplerToken
 * @param {string | null} [dopplerProject]
 * @param {string | null} [dopplerConfig]
 * @param {string} apiDomain 
 * @returns {Promise<Record<string, Record>>}
 */
export async function fetch(dopplerToken, dopplerProject, dopplerConfig, apiDomain) {
  return new Promise(function (resolve, reject) {
    const encodedAuthData = Buffer.from(`${dopplerToken}:`).toString("base64");
    const authHeader = `Basic ${encodedAuthData}`;
    const userAgent = `secrets-fetch-github-action/${VERSION}`;

    const url = new URL(`https://${apiDomain}/v3/configs/config/secrets`);
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
            "accepts": "application/json",
          },
        },
        (res) => {
          let payload = "";
          res.on("data", (data) => (payload += data));
          res.on("end", () => {
            if (res.statusCode === 200) {
              resolve(JSON.parse(payload).secrets);
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

/**
 * Exchange an OIDC token for a short lived Doppler service account token
 * @param {string} identityId 
 * @param {string} oidcToken 
 * @param {string} apiDomain 
 * @returns {Promise<string>}
 */
export async function oidcAuth(identityId, oidcToken, apiDomain) {
  return new Promise(function (resolve, reject) {
    const userAgent = `secrets-fetch-github-action/${VERSION}`;

    const url = new URL(`https://${apiDomain}/v3/auth/oidc`);
    const body = JSON.stringify({
      identity: identityId,
      token: oidcToken
    });
   
    const request = https
      .request(
        url.href,
        {
          headers: {
            "user-agent": userAgent,
            "accepts": "application/json",
            "Content-Type": "application/json",
            "Content-Length": body.length,
          },
          method: 'POST'
        },
        (res) => {
          let payload = "";
          res.on("data", (data) => (payload += data));
          res.on("end", () => {
            if (res.statusCode === 200) {
              resolve(JSON.parse(payload).token);
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
      );

    request
      .on("error", (error) => {
        reject(new Error(`Doppler API Error: ${error}`));
      });

    request.write(body);

    request.end()
  });
}
