import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert";
import https from "https";
import { fetch, oidcAuth, shouldRetry, withRetry, DopplerApiError } from "./doppler.js";

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

      const result = await fetch("dp.st.test", null, null, "api.doppler.com");
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

      const result = await fetch("dp.st.test", null, null, "api.doppler.com");
      assert.strictEqual(attemptCount, 2);
      assert.deepStrictEqual(result, mockSecrets);
    });

    it("should retry on 503 (JSON request timeout) and succeed", async () => {
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

      const result = await fetch("dp.st.test", null, null, "api.doppler.com");
      assert.strictEqual(attemptCount, 2);
      assert.deepStrictEqual(result, mockSecrets);
    });

    it("should NOT retry on 500 with JSON response", async () => {
      let attemptCount = 0;

      mock.method(https, 'get', (url, options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: 500,
          headers: { "content-type": "application/json" },
          on: (event, handler) => {
            if (event === "data") {
              handler(JSON.stringify({ messages: ["Internal server error"] }));
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
          message: /Doppler API Error: Internal server error/,
        }
      );
      assert.strictEqual(attemptCount, 1);
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
          message: /Doppler API Error: Invalid token/,
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

    it("should give up after max attempts (5)", async () => {
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
        async () => await fetch("dp.st.test", null, null, "api.doppler.com"),
        {
          message: /Doppler API Error: 503 Service Unavailable/,
        }
      );
      assert.strictEqual(attemptCount, 5);
    });

    it("should NOT retry on network errors (ECONNREFUSED, etc)", async () => {
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
        async () => await fetch("dp.st.test", null, null, "api.doppler.com"),
        {
          message: /Doppler API Error: Error: ECONNREFUSED/,
        }
      );
      assert.strictEqual(attemptCount, 1);
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

      const result = await oidcAuth("identity-123", async () => "oidc-token-456", "api.doppler.com");
      assert.strictEqual(attemptCount, 2);
      assert.strictEqual(result, mockToken);
    });

    it("should retry on 503 (JSON request timeout) with a fresh OIDC token and succeed", async () => {
      let attemptCount = 0;
      const mockToken = "dp.st.generated-token";
      const sentTokens = [];

      mock.method(https, 'request', (_url, _options, callback) => {
        attemptCount++;
        const mockResponse = {
          statusCode: attemptCount < 2 ? 503 : 200,
          headers: { "content-type": "application/json; charset=utf-8" },
          on: (event, handler) => {
            if (event === "data") {
              const data = attemptCount < 2
                ? JSON.stringify({ success: false, messages: ["Request took longer than 29 seconds"] })
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
          write: (data) => {
            sentTokens.push(JSON.parse(data).token);
          },
          end: () => {},
        };
      });

      const result = await oidcAuth("identity-123", async () => `oidc-token-${sentTokens.length + 1}`, "api.doppler.com");
      assert.strictEqual(attemptCount, 2);
      assert.strictEqual(result, mockToken);
      // The API rejects reused OIDC tokens, so each attempt must request a fresh one
      assert.deepStrictEqual(sentTokens, ["oidc-token-1", "oidc-token-2"]);
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
  });

  describe("shouldRetry()", () => {
    const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

    it("should NOT retry errors that aren't DopplerApiErrors", () => {
      assert.strictEqual(shouldRetry(new Error("ECONNRESET")), false);
      assert.strictEqual(shouldRetry(undefined), false);
    });

    it("should retry 502, 503, and 504 regardless of content type", () => {
      for (const statusCode of [502, 503, 504]) {
        assert.strictEqual(shouldRetry(new DopplerApiError("", statusCode, JSON_CONTENT_TYPE)), true, `${statusCode} JSON`);
        assert.strictEqual(shouldRetry(new DopplerApiError("", statusCode, "text/html")), true, `${statusCode} HTML`);
        assert.strictEqual(shouldRetry(new DopplerApiError("", statusCode, undefined)), true, `${statusCode} no content type`);
      }
    });

    it("should only retry other 5xx errors without a JSON body", () => {
      assert.strictEqual(shouldRetry(new DopplerApiError("", 500, JSON_CONTENT_TYPE)), false);
      assert.strictEqual(shouldRetry(new DopplerApiError("", 500, "text/html")), true);
    });

    it("should retry 429 and 1xx, but not other 4xx", () => {
      assert.strictEqual(shouldRetry(new DopplerApiError("", 429, JSON_CONTENT_TYPE)), true);
      assert.strictEqual(shouldRetry(new DopplerApiError("", 100, JSON_CONTENT_TYPE)), true);
      assert.strictEqual(shouldRetry(new DopplerApiError("", 199, JSON_CONTENT_TYPE)), true);
      assert.strictEqual(shouldRetry(new DopplerApiError("", 401, JSON_CONTENT_TYPE)), false);
      assert.strictEqual(shouldRetry(new DopplerApiError("", 404, JSON_CONTENT_TYPE)), false);
    });
  });

  describe("withRetry()", () => {
    it("should retry any error when given a custom isRetryable", async () => {
      let attemptCount = 0;

      const result = await withRetry(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Error message: socket hang up");
        }
        return "id-token";
      }, { baseDelay: 1, isRetryable: () => true });

      assert.strictEqual(attemptCount, 3);
      assert.strictEqual(result, "id-token");
    });

    it("should throw the last error after max attempts", async () => {
      let attemptCount = 0;

      await assert.rejects(
        withRetry(async () => {
          attemptCount++;
          throw new Error(`failure ${attemptCount}`);
        }, { maxAttempts: 3, baseDelay: 1, isRetryable: () => true }),
        { message: "failure 3" }
      );
      assert.strictEqual(attemptCount, 3);
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
        async () => await fetch("dp.st.test", null, null, "api.doppler.com"),
        {
          message: /Doppler API Error: 500 Internal Server Error/,
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

      const result = await fetch("dp.st.test", null, null, "api.doppler.com");
      assert.strictEqual(attemptCount, 2);
      assert.deepStrictEqual(result, mockSecrets);
    });
  });
});
