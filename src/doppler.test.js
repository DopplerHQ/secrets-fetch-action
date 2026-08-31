import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert";
import https from "https";
import { fetch, oidcAuth } from "./doppler.js";

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

      const result = await oidcAuth("identity-123", "oidc-token-456", "api.doppler.com");
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

      const result = await oidcAuth("identity-123", "oidc-token-456", "api.doppler.com");
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
        async () => await oidcAuth("identity-123", "bad-token", "api.doppler.com"),
        {
          message: /Doppler API Error: Invalid OIDC token/,
        }
      );
      assert.strictEqual(attemptCount, 1);
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
