import https from "https";
import { VERSION } from "./meta.js";

// Adapted from https://github.com/DopplerHQ/cli/blob/a47f6d765bf9cb2155563e61287e325e492e3dea/pkg/http/config.go#L27
const MAX_ATTEMPTS = 5;
const BASE_DELAY = 500;

/**
 * Custom error class for Doppler API errors that the retry wrapper can use to determine if an error should be retried
 */
class DopplerApiError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {string} contentType
   */
  constructor(message, statusCode, contentType) {
    super(message);
    this.statusCode = statusCode;
    this.contentType = contentType;
  }
}


/**
 * Adapted from https://github.com/DopplerHQ/cli/blob/b008b823ec58f6982e26392b6fd0c30345e100a0/pkg/http/http.go#L359-L364
 * Determines if a network error should be retried
 */
function shouldRetry(error) {
  if (!error instanceof DopplerApiError) {
    return false;
  }
  const { statusCode, contentType } = error;
  // don't retry 5xx errors w/ a JSON body
  return (statusCode === 429 || (statusCode >= 100 && statusCode < 199) || (statusCode >=500 && statusCode <= 599 && !contentType?.startsWith("application/json")));

}

/**
 * Retry wrapper with exponential backoff
 * @param {Function} fn - The function to retry
 * @param {number} maxAttempts - Maximum number of attempts
 * @param {number} baseDelay - Base delay in ms
 * @returns {Promise}
 */
async function withRetry(fn, maxAttempts = MAX_ATTEMPTS, baseDelay = BASE_DELAY) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry on the last attempt
      if (attempt === maxAttempts) {
        break;
      }
      
      // Get the status code from the error type
      if (!shouldRetry(error)) {
        break; // Don't retry non-retryable errors
      }

      // Exponential backoff with full-jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * baseDelay;
      await new Promise(resolve => setTimeout(resolve, delay)); 
    }
  }
  
  throw lastError;
}
/**
 * Internal fetch function without retry logic
 * @param {string} dopplerToken
 * @param {string | null} [dopplerProject]
 * @param {string | null} [dopplerConfig]
 * @param {string} apiDomain 
 * @returns {Promise<Record<string, Record>>}
 */
async function _fetch(dopplerToken, dopplerProject, dopplerConfig, apiDomain) {
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
                reject(new DopplerApiError(`Doppler API Error: ${error}`, res.statusCode, res.headers["content-type"]));
              } catch (error) {
                // In the event an upstream issue occurs and no JSON payload is supplied
                reject(new DopplerApiError(`Doppler API Error: ${res.statusCode} ${res.statusMessage}`, res.statusCode, res.headers["content-type"]));
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
 * Internal OIDC auth function without retry logic
 * @param {string} identityId 
 * @param {string} oidcToken 
 * @param {string} apiDomain 
 * @returns {Promise<string>}
 */
async function _oidcAuth(identityId, oidcToken, apiDomain) {
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
                reject(new DopplerApiError(`Doppler API Error: ${error}`, res.statusCode, res.headers["content-type"]));
              } catch (error) {
                // In the event an upstream issue occurs and no JSON payload is supplied
                reject(new DopplerApiError(`Doppler API Error: ${res.statusCode} ${res.statusMessage}`, res.statusCode, res.headers["content-type"]));
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

/**
 * Fetch secrets from Doppler the API with retry logic
 * @param {string} dopplerToken
 * @param {string | null} [dopplerProject]
 * @param {string | null} [dopplerConfig]
 * @param {string} apiDomain 
 * @returns {Promise<Record<string, Record>>}
 */
export async function fetch(dopplerToken, dopplerProject, dopplerConfig, apiDomain) {
  return withRetry(() => _fetch(dopplerToken, dopplerProject, dopplerConfig, apiDomain));
}

/**
 * Exchange an OIDC token for a short lived Doppler service account token with retry logic
 * @param {string} identityId 
 * @param {string} oidcToken 
 * @param {string} apiDomain 
 * @returns {Promise<string>}
 */
export async function oidcAuth(identityId, oidcToken, apiDomain) {
  return withRetry(() => _oidcAuth(identityId, oidcToken, apiDomain));
}
