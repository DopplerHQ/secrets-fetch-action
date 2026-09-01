import { describe, it } from "node:test";
import assert from "node:assert";
import { isFatal, processSecrets, reportProblems } from "./secrets.js";

describe("Secret Processing", () => {
  /** Minimal @actions/core stand-in that records what the action wrote */
  function fakeCore() {
    return {
      outputs: new Map(),
      envVars: new Map(),
      masked: [],
      warnings: [],
      errors: [],
      failures: [],
      setOutput(name, value) {
        this.outputs.set(name, value);
      },
      exportVariable(name, value) {
        this.envVars.set(name, value);
      },
      setSecret(value) {
        this.masked.push(value);
      },
      warning(message) {
        this.warnings.push(message);
      },
      error(message) {
        this.errors.push(message);
      },
      setFailed(message) {
        this.failures.push(message);
      },
      startGroup() {},
      endGroup() {},
    };
  }

  /** Build an API-shaped secrets payload from a plain name/value map */
  function payload(entries, overrides = {}) {
    return Object.fromEntries(
      Object.entries(entries).map(([name, computed]) => [name, { computed, ...(overrides[name] ?? {}) }]),
    );
  }

  const kinds = (problems) => problems.map((problem) => problem.kind).sort();

  describe("processSecrets() - names that work everywhere", () => {
    it("should set outputs and mask values for conforming names", () => {
      const core = fakeCore();
      const problems = processSecrets(payload({ API_KEY: "a", api_key_2: "b" }), { core });

      assert.deepStrictEqual(problems, []);
      assert.strictEqual(core.outputs.get("API_KEY"), "a");
      assert.strictEqual(core.outputs.get("api_key_2"), "b");
      assert.deepStrictEqual(core.masked, ["a", "b"]);
    });

    it("should not export environment variables unless asked", () => {
      const core = fakeCore();
      processSecrets(payload({ API_KEY: "a" }), { core });
      assert.strictEqual(core.envVars.size, 0);
    });

    it("should export environment variables when inject-env-vars is on", () => {
      const core = fakeCore();
      processSecrets(payload({ API_KEY: "a" }), { core, injectEnvVars: true });
      assert.strictEqual(core.envVars.get("API_KEY"), "a");
    });
  });

  describe("processSecrets() - masking", () => {
    it("should skip masking for Doppler metadata", () => {
      const core = fakeCore();
      processSecrets(payload({ DOPPLER_PROJECT: "proj", DOPPLER_CONFIG: "prd", API_KEY: "a" }), { core });
      assert.deepStrictEqual(core.masked, ["a"]);
    });

    it("should mask a user secret whose name only differs from metadata by case", () => {
      const core = fakeCore();
      processSecrets(payload({ doppler_project: "sneaky" }), { core });
      assert.deepStrictEqual(core.masked, ["sneaky"]);
    });

    it("should skip masking for explicitly unmasked secrets", () => {
      const core = fakeCore();
      processSecrets(payload({ PUBLIC: "v" }, { PUBLIC: { computedVisibility: "unmasked" } }), { core });
      assert.deepStrictEqual(core.masked, []);
    });

    it("should mask the value even when the name is unusable", () => {
      const core = fakeCore();
      processSecrets(payload({ "BAD\nNAME": "leaky" }), { core });
      assert.deepStrictEqual(core.masked, ["leaky"]);
      assert.strictEqual(core.outputs.size, 0);
    });
  });

  describe("processSecrets() - non-conforming names", () => {
    it("should report a shell problem for dashes but still export them", () => {
      const core = fakeCore();
      const problems = processSecrets(payload({ "MY-SECRET": "v" }), { core, injectEnvVars: true });

      assert.deepStrictEqual(kinds(problems), ["shell"]);
      assert.strictEqual(core.envVars.get("MY-SECRET"), "v");
      // Dashes are fine in expressions, so no expr problem.
      assert.strictEqual(core.outputs.get("MY-SECRET"), "v");
    });

    it("should report both problems for a slash", () => {
      const core = fakeCore();
      const problems = processSecrets(payload({ "MY/SECRET": "v" }), { core, injectEnvVars: true });
      assert.deepStrictEqual(kinds(problems), ["expr", "shell"]);
    });

    it("should report only an expr problem when env injection is off", () => {
      const core = fakeCore();
      const problems = processSecrets(payload({ "MY/SECRET": "v" }), { core });
      assert.deepStrictEqual(kinds(problems), ["expr"]);
    });

    it("should never write a structurally unsafe name to any sink", () => {
      const core = fakeCore();
      const problems = processSecrets(payload({ "A=B": "v", "C\nD": "w" }), { core, injectEnvVars: true });

      assert.deepStrictEqual(kinds(problems), ["structural", "structural"]);
      assert.strictEqual(core.outputs.size, 0);
      assert.strictEqual(core.envVars.size, 0);
    });
  });

  describe("processSecrets() - case collisions", () => {
    it("should flag names that fold to the same environment variable", () => {
      const core = fakeCore();
      const problems = processSecrets(payload({ api_key: "first", API_KEY: "second" }), {
        core,
        injectEnvVars: true,
      });

      const collision = problems.find((problem) => problem.kind === "collision");
      assert.ok(collision, "expected a collision problem");
      assert.strictEqual(collision.name, "API_KEY");
      assert.strictEqual(collision.other, "api_key");
    });

    it("should not flag collisions when env injection is off", () => {
      const core = fakeCore();
      const problems = processSecrets(payload({ api_key: "first", API_KEY: "second" }), { core });
      assert.deepStrictEqual(problems, []);
    });

    it("should not flag distinct names", () => {
      const core = fakeCore();
      const problems = processSecrets(payload({ API_KEY: "a", API_SECRET: "b" }), {
        core,
        injectEnvVars: true,
      });
      assert.deepStrictEqual(problems, []);
    });
  });

  describe("processSecrets() - skip policy", () => {
    it("should omit the environment variable but keep the usable output", () => {
      const core = fakeCore();
      processSecrets(payload({ "MY-SECRET": "v" }), {
        core,
        injectEnvVars: true,
        onInvalidName: "skip",
      });

      assert.strictEqual(core.envVars.has("MY-SECRET"), false);
      assert.strictEqual(core.outputs.get("MY-SECRET"), "v");
    });

    it("should omit an output that needs index syntax", () => {
      const core = fakeCore();
      processSecrets(payload({ "MY/SECRET": "v" }), { core, onInvalidName: "skip" });
      assert.strictEqual(core.outputs.size, 0);
    });

    it("should keep the first of two colliding names rather than the last", () => {
      const core = fakeCore();
      processSecrets(payload({ api_key: "first", API_KEY: "second" }), {
        core,
        injectEnvVars: true,
        onInvalidName: "skip",
      });

      assert.strictEqual(core.envVars.get("api_key"), "first");
      assert.strictEqual(core.envVars.has("API_KEY"), false);
    });

    it("should still mask values it declines to write", () => {
      const core = fakeCore();
      processSecrets(payload({ "MY/SECRET": "v" }), { core, onInvalidName: "skip" });
      assert.deepStrictEqual(core.masked, ["v"]);
    });
  });

  describe("isFatal()", () => {
    const linux = { onInvalidName: "warn", platform: "linux" };

    it("should always treat structural problems as fatal", () => {
      assert.strictEqual(isFatal({ kind: "structural" }, linux), true);
    });

    it("should treat collisions as fatal on Windows only", () => {
      assert.strictEqual(isFatal({ kind: "collision" }, linux), false);
      assert.strictEqual(isFatal({ kind: "collision" }, { ...linux, platform: "win32" }), true);
    });

    it("should treat other problems as fatal only under the error policy", () => {
      assert.strictEqual(isFatal({ kind: "shell" }, linux), false);
      assert.strictEqual(isFatal({ kind: "shell" }, { ...linux, onInvalidName: "error" }), true);
    });
  });

  describe("reportProblems()", () => {
    const options = (overrides = {}) => ({ onInvalidName: "warn", platform: "linux", ...overrides });

    it("should say nothing when there are no problems", () => {
      const core = fakeCore();
      assert.strictEqual(reportProblems([], { core, ...options() }), false);
      assert.deepStrictEqual(core.warnings, []);
    });

    it("should emit one grouped message per kind, not one per secret", () => {
      const core = fakeCore();
      const problems = [
        { name: "A-1", kind: "shell" },
        { name: "A-2", kind: "shell" },
        { name: "B/1", kind: "expr" },
      ];
      reportProblems(problems, { core, ...options() });

      assert.strictEqual(core.warnings.length, 2);
      const shell = core.warnings.find((message) => message.includes("$NAME"));
      assert.match(shell, /2 secret names/);
      assert.match(shell, /'A-1', 'A-2'/);
    });

    it("should agree verb number with the count", () => {
      const one = fakeCore();
      reportProblems([{ name: "A/1", kind: "expr" }], { core: one, ...options() });
      assert.match(one.warnings[0], /1 step output needs index syntax/);

      const many = fakeCore();
      reportProblems([{ name: "A/1", kind: "expr" }, { name: "A/2", kind: "expr" }], {
        core: many,
        ...options(),
      });
      assert.match(many.warnings[0], /2 step outputs need index syntax/);
    });

    it("should describe a single collision in the singular", () => {
      const core = fakeCore();
      reportProblems([{ name: "api_key", kind: "collision", other: "API_KEY" }], { core, ...options() });
      assert.match(core.warnings[0], /1 secret name differs from another only by case/);
      assert.match(core.warnings[0], /'api_key' vs 'API_KEY'/);
    });

    it("should mention the skipped write under the skip policy", () => {
      const core = fakeCore();
      reportProblems([{ name: "A-1", kind: "shell" }], {
        core,
        ...options({ onInvalidName: "skip" }),
      });
      assert.match(core.warnings[0], /was not exported/);
    });

    // Guards against a nested-template mistake leaking `${...}` into the log.
    it("should fully expand every message", () => {
      const core = fakeCore();
      const every = [
        { name: "A=B", kind: "structural" },
        { name: "A-1", kind: "shell" },
        { name: "A/1", kind: "expr" },
        { name: "api_key", kind: "collision", other: "API_KEY" },
      ];
      for (const policy of ["warn", "error", "skip"]) {
        reportProblems(every, { core, ...options({ onInvalidName: policy }) });
      }
      for (const message of [...core.warnings, ...core.errors, ...core.failures]) {
        // `${{ env[...] }}` is legitimate Actions syntax; a bare `${` is not.
        assert.doesNotMatch(message, /\$\{(?!\{)/, `unexpanded template in: ${message}`);
      }
    });

    it("should cap long name lists", () => {
      const core = fakeCore();
      const problems = Array.from({ length: 13 }, (_, index) => ({ name: `S-${index}`, kind: "shell" }));
      reportProblems(problems, { core, ...options() });

      assert.match(core.warnings[0], /\(\+3 more\)/);
    });

    it("should fail the step on a structural problem even under the warn policy", () => {
      const core = fakeCore();
      const failed = reportProblems([{ name: "A=B", kind: "structural" }], { core, ...options() });

      assert.strictEqual(failed, true);
      assert.strictEqual(core.failures.length, 1);
      assert.strictEqual(core.errors.length, 1);
    });

    it("should warn but not fail on a shell problem under the warn policy", () => {
      const core = fakeCore();
      const failed = reportProblems([{ name: "A-B", kind: "shell" }], { core, ...options() });

      assert.strictEqual(failed, false);
      assert.deepStrictEqual(core.failures, []);
      assert.strictEqual(core.warnings.length, 1);
    });

    it("should fail on a shell problem under the error policy", () => {
      const core = fakeCore();
      const failed = reportProblems([{ name: "A-B", kind: "shell" }], {
        core,
        ...options({ onInvalidName: "error" }),
      });

      assert.strictEqual(failed, true);
      assert.strictEqual(core.errors.length, 1);
    });

    it("should fail on a collision on Windows but not on Linux", () => {
      const collision = [{ name: "API_KEY", kind: "collision", other: "api_key" }];

      const linux = fakeCore();
      assert.strictEqual(reportProblems(collision, { core: linux, ...options() }), false);

      const windows = fakeCore();
      assert.strictEqual(
        reportProblems(collision, { core: windows, ...options({ platform: "win32" }) }),
        true,
      );
      assert.match(windows.errors[0], /'API_KEY' vs 'api_key'/);
    });
  });
});
