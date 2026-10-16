import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert";
import https from "https";
import { fetch, oidcAuth, shouldRetry, DopplerApiError } from "./doppler.js";

describe("Doppler API Client", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  describe("fetch() - Happy Path", () => {
    it("should successfully fetch secrets on first attempt", async () => {
      const mockSecrets = {
        API_KEY: { computed: "secret-value", computedVisibility: "masked" },
        DB_HOST: { computed: "localhost", computedVisibility: "masked" },
      };

      mock.method(https, 'get', (url, options, callback) => {
        const mockResponse = {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              handler(JSON.stringify({ secrets: mockSecrets }));
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {} };
      });

      const result = await fetch("dp.st.test", null, null, "api.doppler.com");
      assert.deepStrictEqual(result, mockSecrets);
    });

    it("should fetch secrets with project and config params", async () => {
      const mockSecrets = { KEY: { computed: "value", computedVisibility: "masked" } };
      let capturedUrl = "";

      mock.method(https, 'get', (url, options, callback) => {
        capturedUrl = url;
        const mockResponse = {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              handler(JSON.stringify({ secrets: mockSecrets }));
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {} };
      });

      await fetch("dp.sa.test", "my-project", "dev", "api.doppler.com");
      assert.ok(capturedUrl.includes("project=my-project"));
      assert.ok(capturedUrl.includes("config=dev"));
    });
  });

  describe("fetch() - Retry Logic", () => {
    it("should retry on 429 (rate limit) and succeed", async () => {
      let attemptCount = 0;
      const mockSecrets = { KEY: { computed: "value", computedVisibility: "masked" } };

      mock.method(https, 'get', (url, options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: attemptCount < 3 ? 429 : 200,
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              const data = attemptCount < 3
                ? JSON.stringify({ messages: ["Rate limit exceeded"] })
                : JSON.stringify({ secrets: mockSecrets });
              handler(data);
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {} };
      });

      const result = await fetch("dp.st.test", null, null, "api.doppler.com", { baseDelay: 1 });
      assert.strictEqual(attemptCount, 3);
      assert.deepStrictEqual(result, mockSecrets);
    });

    it("should retry on 503 (non-JSON) and succeed", async () => {
      let attemptCount = 0;
      const mockSecrets = { KEY: { computed: "value", computedVisibility: "masked" } };

      mock.method(https, 'get', (url, options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: attemptCount < 2 ? 503 : 200,
          statusMessage: "Service Unavailable",
          headers: { "content-type": attemptCount < 2 ? "text/html" : "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              const data = attemptCount < 2
                ? "<html>Service Unavailable</html>"
                : JSON.stringify({ secrets: mockSecrets });
              handler(data);
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {} };
      });

      const result = await fetch("dp.st.test", null, null, "api.doppler.com", { baseDelay: 1 });
      assert.strictEqual(attemptCount, 2);
      assert.deepStrictEqual(result, mockSecrets);
    });

    it("should retry on 503 with a JSON body (API request timeout) and succeed", async () => {
      let attemptCount = 0;
      const mockSecrets = { KEY: { computed: "value", computedVisibility: "masked" } };

      mock.method(https, 'get', (url, options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: attemptCount < 2 ? 503 : 200,
          headers: { "content-type": "application/json; charset=utf-8" },
          on: (event, handler) => {
            if (event === "data") {
              const data = attemptCount < 2
                ? JSON.stringify({ success: false, messages: ["Request took longer than 29 seconds"] })
                : JSON.stringify({ secrets: mockSecrets });
              handler(data);
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {} };
      });

      const result = await fetch("dp.st.test", null, null, "api.doppler.com", { baseDelay: 1 });
      assert.strictEqual(attemptCount, 2);
      assert.deepStrictEqual(result, mockSecrets);
    });

    it("should wait at least as long as Retry-After", async () => {
      let attemptCount = 0;
      const delays = [];
      const mockSecrets = { KEY: { computed: "value", computedVisibility: "masked" } };

      mock.method(https, 'get', (url, options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: attemptCount < 2 ? 429 : 200,
          headers: { "content-type": "application/json", "retry-after": attemptCount < 2 ? "0.2" : undefined },
          on: (event, handler) => {
            if (event === "data") {
              const data = attemptCount < 2
                ? JSON.stringify({ messages: ["Rate limit exceeded"] })
                : JSON.stringify({ secrets: mockSecrets });
              handler(data);
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {} };
      });

      await fetch("dp.st.test", null, null, "api.doppler.com", { baseDelay: 1, onRetry: (_error, _attempt, delay) => delays.push(delay) });
      assert.strictEqual(attemptCount, 2);
      assert.deepStrictEqual(delays, [200]);
    });

    it("should retry a request that times out", async () => {
      let attemptCount = 0;
      const mockSecrets = { KEY: { computed: "value", computedVisibility: "masked" } };

      mock.method(https, 'get', (url, options, callback) => {
        attemptCount++;
        assert.strictEqual(options.timeout, 35_000);
        const handlers = {};
        const request = {
          on: (event, handler) => {
            handlers[event] = handler;
            return request;
          },
          destroy: (error) => handlers.error(error),
        };
        if (attemptCount < 2) {
          setImmediate(() => handlers.timeout());
          return request;
        }
        const mockResponse = {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              handler(JSON.stringify({ secrets: mockSecrets }));
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return request;
      });

      const result = await fetch("dp.st.test", null, null, "api.doppler.com", { baseDelay: 1 });
      assert.strictEqual(attemptCount, 2);
      assert.deepStrictEqual(result, mockSecrets);
    });

    it("should NOT retry on 401 (unauthorized)", async () => {
      let attemptCount = 0;

      mock.method(https, 'get', (url, options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: 401,
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              handler(JSON.stringify({ messages: ["Invalid token"] }));
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {} };
      });

      await assert.rejects(
        async () => await fetch("dp.st.invalid", null, null, "api.doppler.com"),
        {
          // Anchored to check a non-retryable error gets no "gave up after" suffix
          message: /^Doppler API Error: Invalid token$/,
        }
      );
      assert.strictEqual(attemptCount, 1);
    });

    it("should NOT retry on 404 (not found)", async () => {
      let attemptCount = 0;

      mock.method(https, 'get', (url, options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: 404,
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              handler(JSON.stringify({ messages: ["Not found"] }));
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {} };
      });

      await assert.rejects(
        async () => await fetch("dp.st.test", null, null, "api.doppler.com"),
        {
          message: /Doppler API Error: Not found/,
        }
      );
      assert.strictEqual(attemptCount, 1);
    });

    it("should give up after max attempts (8)", async () => {
      let attemptCount = 0;

      mock.method(https, 'get', (url, options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: 503,
          statusMessage: "Service Unavailable",
          headers: { "content-type": "text/html" },
          on: (event, handler) => {
            if (event === "data") {
              handler("<html>Service Unavailable</html>");
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {} };
      });

      await assert.rejects(
        async () => await fetch("dp.st.test", null, null, "api.doppler.com", { baseDelay: 1 }),
        {
          message: /Doppler API Error: 503 Service Unavailable \(gave up after 8 attempt\(s\)\)/,
        }
      );
      assert.strictEqual(attemptCount, 8);
    });

    it("should stop retrying at the deadline", async () => {
      let attemptCount = 0;

      mock.method(https, 'get', (url, options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: 503,
          statusMessage: "Service Unavailable",
          headers: { "content-type": "text/html" },
          on: (event, handler) => {
            if (event === "data") {
              handler("<html>Service Unavailable</html>");
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {} };
      });

      await assert.rejects(
        async () => await fetch("dp.st.test", null, null, "api.doppler.com", { deadline: Date.now() + 100 }),
        {
          message: /gave up after 1 attempt\(s\)/,
        }
      );
      assert.strictEqual(attemptCount, 1);
    });

    it("should retry on network errors (ECONNREFUSED, etc)", async () => {
      let attemptCount = 0;

      mock.method(https, 'get', () => {
        attemptCount++;
        const request = {
          on: (event, handler) => {
            if (event === "error") {
              handler(new Error("ECONNREFUSED"));
            }
            return request;
          },
        };
        return request;
      });

      await assert.rejects(
        async () => await fetch("dp.st.test", null, null, "api.doppler.com", { baseDelay: 1 }),
        {
          message: /Doppler API Error: Error: ECONNREFUSED/,
        }
      );
      assert.strictEqual(attemptCount, 8);
    });
  });

  describe("oidcAuth() - Happy Path", () => {
    it("should successfully exchange OIDC token", async () => {
      const mockToken = "dp.st.generated-token";
      let requestBody = "";

      mock.method(https, 'request', (_url, _options, callback) => {
        const mockResponse = {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              handler(JSON.stringify({ token: mockToken }));
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return {
          on: () => ({
            write: (data) => {
              requestBody = data;
            },
            end: () => {},
          }),
          write: (data) => {
            requestBody = data;
          },
          end: () => {},
        };
      });

      const result = await oidcAuth("identity-123", async () => "oidc-token-456", "api.doppler.com");
      assert.strictEqual(result, mockToken);

      const parsedBody = JSON.parse(requestBody);
      assert.strictEqual(parsedBody.identity, "identity-123");
      assert.strictEqual(parsedBody.token, "oidc-token-456");
    });
  });

  describe("oidcAuth() - Retry Logic", () => {
    it("should retry on 429 and succeed", async () => {
      let attemptCount = 0;
      const mockToken = "dp.st.generated-token";

      mock.method(https, 'request', (_url, _options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: attemptCount < 2 ? 429 : 200,
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              const data = attemptCount < 2
                ? JSON.stringify({ messages: ["Rate limit exceeded"] })
                : JSON.stringify({ token: mockToken });
              handler(data);
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return {
          on: () => ({
            write: () => {},
            end: () => {},
          }),
          write: () => {},
          end: () => {},
        };
      });

      const result = await oidcAuth("identity-123", async () => "oidc-token-456", "api.doppler.com", { baseDelay: 1 });
      assert.strictEqual(attemptCount, 2);
      assert.strictEqual(result, mockToken);
    });

    it("should NOT retry on 401 (invalid OIDC token)", async () => {
      let attemptCount = 0;

      mock.method(https, 'request', (_url, _options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: 401,
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              handler(JSON.stringify({ messages: ["Invalid OIDC token"] }));
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return {
          on: () => ({
            write: () => {},
            end: () => {},
          }),
          write: () => {},
          end: () => {},
        };
      });

      await assert.rejects(
        async () => await oidcAuth("identity-123", async () => "bad-token", "api.doppler.com"),
        {
          message: /Doppler API Error: Invalid OIDC token/,
        }
      );
      assert.strictEqual(attemptCount, 1);
    });

    it("should retry on 400 when the API cannot fetch GitHub's JWKS, with a fresh OIDC token", async () => {
      let attemptCount = 0;
      const mockToken = "dp.st.generated-token";
      const sentTokens = [];

      mock.method(https, 'request', (_url, _options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: attemptCount < 2 ? 400 : 200,
          headers: { "content-type": "application/json; charset=utf-8" },
          on: (event, handler) => {
            if (event === "data") {
              const data = attemptCount < 2
                ? JSON.stringify({ success: false, messages: ["Unable to validate OIDC JWT token: could not retrieve JSON Web Key Set"] })
                : JSON.stringify({ token: mockToken });
              handler(data);
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return {
          on: () => {},
          write: (data) => sentTokens.push(JSON.parse(data).token),
          end: () => {},
        };
      });

      const result = await oidcAuth("identity-123", async () => `oidc-token-${sentTokens.length + 1}`, "api.doppler.com", { baseDelay: 1 });
      assert.strictEqual(attemptCount, 2);
      assert.strictEqual(result, mockToken);
      assert.deepStrictEqual(sentTokens, ["oidc-token-1", "oidc-token-2"]);
    });

    it("should retry when getting the OIDC token fails", async () => {
      let tokenAttempts = 0;
      const mockToken = "dp.st.generated-token";

      mock.method(https, 'request', (_url, _options, callback) => {
        const mockResponse = {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              handler(JSON.stringify({ token: mockToken }));
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {}, write: () => {}, end: () => {} };
      });

      const getOidcToken = async () => {
        tokenAttempts++;
        if (tokenAttempts < 2) {
          throw new Error("Failed to get ID Token. Error Code : 503");
        }
        return "oidc-token";
      };

      const result = await oidcAuth("identity-123", getOidcToken, "api.doppler.com", { baseDelay: 1 });
      assert.strictEqual(tokenAttempts, 2);
      assert.strictEqual(result, mockToken);
    });

    it("should rethrow a non-Error thrown while getting the OIDC token unchanged", async () => {
      await assert.rejects(
        oidcAuth("identity-123", async () => { throw "boom"; }, "api.doppler.com", { maxAttempts: 2, baseDelay: 1 }),
        (error) => error === "boom"
      );
    });
  });

  describe("shouldRetry()", () => {
    it("should retry network errors and every 5xx", () => {
      assert.strictEqual(shouldRetry(new Error("ECONNRESET")), true);
      assert.strictEqual(shouldRetry(new DopplerApiError("Doppler API Error: Internal server error", 500)), true);
      assert.strictEqual(shouldRetry(new DopplerApiError("Doppler API Error: Request took longer than 29 seconds", 503)), true);
    });

    it("should retry 408, 425, and 429", () => {
      for (const statusCode of [408, 425, 429]) {
        assert.strictEqual(shouldRetry(new DopplerApiError("", statusCode)), true, `${statusCode}`);
      }
    });

    it("should NOT retry other 4xx errors", () => {
      assert.strictEqual(shouldRetry(new DopplerApiError("Doppler API Error: Invalid token", 401)), false);
      assert.strictEqual(shouldRetry(new DopplerApiError("Doppler API Error: Forbidden", 403)), false);
      assert.strictEqual(shouldRetry(new DopplerApiError("Doppler API Error: Unable to validate OIDC JWT token: claim \"sub\" does not match", 400)), false);
      // Even when the message suggests trying again
      assert.strictEqual(shouldRetry(new DopplerApiError("Doppler API Error: Unable to authenticate. Please check your credentials and try again.", 400)), false);
    });

    it("should retry a 400 when the API cannot reach the OIDC provider", () => {
      assert.strictEqual(shouldRetry(new DopplerApiError("Doppler API Error: Unable to validate OIDC JWT token: could not retrieve JSON Web Key Set", 400)), true);
      assert.strictEqual(shouldRetry(new DopplerApiError("Doppler API Error: Unable to retrieve Open ID Discovery Document", 400)), true);
    });

    it("should NOT retry a 400 for an OIDC provider response that is too large", () => {
      assert.strictEqual(shouldRetry(new DopplerApiError("Doppler API Error: Unable to validate OIDC JWT token: could not retrieve JSON Web Key Set: Response exceeds 1048576 bytes", 400)), false);
      assert.strictEqual(shouldRetry(new DopplerApiError("Doppler API Error: Unable to retrieve Open ID Discovery Document: Response exceeds 1048576 bytes", 400)), false);
    });

    describe("GitHub OIDC token request errors", () => {
      // Builds an error in the format getIDToken() rejects with in @actions/core v3
      const idTokenError = (code, message) =>
        new Error(`Error message: Failed to get ID Token. \n \n        Error Code : ${code}\n \n        Error Message: ${message}`);

      it("should retry connection failures, 5xx, and 429", () => {
        assert.strictEqual(shouldRetry(idTokenError(undefined, "connect ECONNREFUSED 127.0.0.1:9")), true);
        assert.strictEqual(shouldRetry(idTokenError(undefined, "socket hang up")), true);
        assert.strictEqual(shouldRetry(idTokenError(500, "Internal Server Error")), true);
        assert.strictEqual(shouldRetry(idTokenError(429, "slow down")), true);
      });

      it("should NOT retry other 4xx responses", () => {
        assert.strictEqual(shouldRetry(idTokenError(401, "Unauthorized")), false);
        assert.strictEqual(shouldRetry(idTokenError(403, "Failed request: (403)")), false);
      });

      it("should retry a 5xx whose body mentions a 4xx", () => {
        assert.strictEqual(shouldRetry(idTokenError(500, "upstream said Error Code : 403")), true);
      });

      it("should NOT retry a response without a token", () => {
        // getIDToken()'s error for a 404, or a 200 without a token in the body
        assert.strictEqual(shouldRetry(new Error("Error message: Response json body do not have ID Token field")), false);
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle malformed JSON response gracefully", async () => {
      mock.method(https, 'get', (_url, _options, callback) => {
        const mockResponse = {
          statusCode: 500,
          statusMessage: "Internal Server Error",
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              handler("not valid json");
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {} };
      });

      await assert.rejects(
        async () => await fetch("dp.st.test", null, null, "api.doppler.com", { maxAttempts: 1 }),
        {
          message: /^Doppler API Error: 500 Internal Server Error/,
        }
      );
    });

    it("should retry on 1xx informational status codes", async () => {
      let attemptCount = 0;
      const mockSecrets = { KEY: { computed: "value", computedVisibility: "masked" } };

      mock.method(https, 'get', (_url, _options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: attemptCount < 2 ? 100 : 200,
          statusMessage: attemptCount < 2 ? "Continue" : "OK",
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              const data = attemptCount < 2
                ? JSON.stringify({ messages: ["Continue"] })
                : JSON.stringify({ secrets: mockSecrets });
              handler(data);
            } else if (event === "end") {
              handler();
            }
            return mockResponse;
          },
        };
        callback(mockResponse);
        return { on: () => {} };
      });

      const result = await fetch("dp.st.test", null, null, "api.doppler.com", { baseDelay: 1 });
      assert.strictEqual(attemptCount, 2);
      assert.deepStrictEqual(result, mockSecrets);
    });
  });
});
