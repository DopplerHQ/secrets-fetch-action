import { describe, it } from "node:test";
import assert from "node:assert";
import { classify, collisionKey } from "./names.js";

describe("Secret Name Classification", () => {
  describe("classify()", () => {
    const cases = [
      // name,               structurallyUnsafe, shellSafe, exprSafe
      ["API_KEY", false, true, true],
      ["api_key", false, true, true],
      ["MixedCase", false, true, true],
      ["_LEADING_UNDERSCORE", false, true, true],
      ["WITH_DIGITS_123", false, true, true],
      // Dashes are legal in Actions expressions (steps.setup-node.outputs.node-version)
      // but not expandable as $NAME in a shell.
      ["WITH-DASH", false, false, true],
      ["with-dash", false, false, true],
      // Slashes break both.
      ["WITH/SLASH", false, false, false],
      ["a/b/c", false, false, false],
      // Dots break bare property access and shell expansion.
      ["with.dot", false, false, false],
      // A leading digit is not a valid identifier in either place.
      ["9LEADING", false, false, false],
      // Structurally unsafe: would corrupt the file command format.
      ["", true, false, false],
      ["HAS\nNEWLINE", true, false, false],
      ["HAS\rRETURN", true, false, false],
      ["HAS\0NULL", true, false, false],
      ["HAS=EQUALS", true, false, false],
    ];

    for (const [name, structurallyUnsafe, shellSafe, exprSafe] of cases) {
      it(`should classify ${JSON.stringify(name)}`, () => {
        assert.deepStrictEqual(classify(name), { name, structurallyUnsafe, shellSafe, exprSafe });
      });
    }
  });

  describe("collisionKey()", () => {
    it("should fold case so Windows-equivalent names share a key", () => {
      assert.strictEqual(collisionKey("api_key"), collisionKey("API_KEY"));
    });

    it("should keep genuinely distinct names apart", () => {
      assert.notStrictEqual(collisionKey("API_KEY"), collisionKey("API_SECRET"));
    });

    it("should not fold dashes and underscores together", () => {
      assert.notStrictEqual(collisionKey("a-b"), collisionKey("a_b"));
    });
  });
});
