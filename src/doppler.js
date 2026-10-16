import https from "https";
import { VERSION } from "./meta.js";

const MAX_ATTEMPTS = 8;
const BASE_DELAY = 1000;
const MAX_DELAY = 20_000;
const TOTAL_TIMEOUT = 300_000;
const REQUEST_TIMEOUT = 35_000;
const MAX_RETRY_AFTER = 60_000;
const TRANSIENT_STATUS_CODES = [408, 425, 429];
// The API reports its own upstream outages as JSON errors, e.g. a 400 when it cannot fetch GitHub's JWKS
const TRANSIENT_MESSAGES = /JSON Web Key Set|took longer than|temporarily unavailable|try again/i;

/**
 * Custom error class for Doppler API errors that the retry wrapper can use to determine if an error should be retried
 */
export class DopplerApiError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {number | undefined} retryAfter - Delay in ms requested by the Retry-After header
   */
  constructor(message, statusCode, retryAfter) {
    super(message);
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}

/**
 * Parses a Retry-After header given in seconds or as an HTTP date
 * @param {string | undefined} header
 * @returns {number | undefined} Delay in ms
 */
function parseRetryAfter(header) {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(delay) && delay >= 0 ? Math.min(delay, MAX_RETRY_AFTER) : undefined;
}

/**
 * Determines if an error should be retried
 * Network errors and timeouts are retried. API errors are retried unless they are a 4xx that is not transient.
 */
export function shouldRetry(error) {
  if (!(error instanceof DopplerApiError)) {
    return true;
  }
  const { statusCode, message } = error;
  return statusCode >= 500 || (statusCode >= 100 && statusCode <= 199) || TRANSIENT_STATUS_CODES.includes(statusCode) || TRANSIENT_MESSAGES.test(message);
}

/**
 * Retry wrapper with exponential backoff
 * @param {Function} fn - The function to retry
 * @param {object} [options]
 * @param {number} [options.maxAttempts] - Maximum number of attempts
 * @param {number} [options.baseDelay] - Base delay in ms, doubled on every attempt
 * @param {number} [options.maxDelay] - Maximum delay in ms between attempts
 * @param {number} [options.deadline] - Timestamp in ms after which no further attempt starts
 * @param {Function} [options.onRetry] - Called with the error, attempt, and delay before every retry
 * @returns {Promise}
 */
async function withRetry(fn, { maxAttempts = MAX_ATTEMPTS, baseDelay = BASE_DELAY, maxDelay = MAX_DELAY, deadline = Date.now() + TOTAL_TIMEOUT, onRetry = () => {} } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Exponential backoff with equal jitter, never shorter than the API's Retry-After
      const ceiling = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      const delay = Math.max(error.retryAfter ?? 0, ceiling / 2 + Math.random() * ceiling / 2);
      if (attempt >= maxAttempts || !shouldRetry(error) || Date.now() + delay >= deadline) {
        error.message = `${error.message} (gave up after ${attempt} attempt(s))`;
        throw error;
      }
      onRetry(error, attempt, delay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
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

    const request = https
      .get(
        url.href,
        {
          headers: {
            Authorization: authHeader,
            "user-agent": userAgent,
            "accepts": "application/json",
          },
          timeout: REQUEST_TIMEOUT,
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
                reject(new DopplerApiError(`Doppler API Error: ${error}`, res.statusCode, parseRetryAfter(res.headers["retry-after"])));
              } catch (error) {
                // In the event an upstream issue occurs and no JSON payload is supplied
                reject(new DopplerApiError(`Doppler API Error: ${res.statusCode} ${res.statusMessage}`, res.statusCode, parseRetryAfter(res.headers["retry-after"])));
              }
            }
          });
        }
      );

    request.on("timeout", () => request.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT / 1000}s`)));
    request.on("error", (error) => {
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
          method: 'POST',
          timeout: REQUEST_TIMEOUT,
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
                reject(new DopplerApiError(`Doppler API Error: ${error}`, res.statusCode, parseRetryAfter(res.headers["retry-after"])));
              } catch (error) {
                // In the event an upstream issue occurs and no JSON payload is supplied
                reject(new DopplerApiError(`Doppler API Error: ${res.statusCode} ${res.statusMessage}`, res.statusCode, parseRetryAfter(res.headers["retry-after"])));
              }
            }
          });
        }
      );

    request.on("timeout", () => request.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT / 1000}s`)));
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
 * @param {object} [retryOptions] - Passed to withRetry
 * @returns {Promise<Record<string, Record>>}
 */
export async function fetch(dopplerToken, dopplerProject, dopplerConfig, apiDomain, retryOptions) {
  return withRetry(() => _fetch(dopplerToken, dopplerProject, dopplerConfig, apiDomain), retryOptions);
}

/**
 * Exchange an OIDC token for a short lived Doppler service account token with retry logic
 * @param {string} identityId 
 * @param {Function} getOidcToken - Called on every attempt, since the API rejects a reused OIDC token
 * @param {string} apiDomain 
 * @param {object} [retryOptions] - Passed to withRetry
 * @returns {Promise<string>}
 */
export async function oidcAuth(identityId, getOidcToken, apiDomain, retryOptions) {
  return withRetry(async () => _oidcAuth(identityId, await getOidcToken(), apiDomain), retryOptions);
}
