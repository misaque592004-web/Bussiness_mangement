import test from "node:test";
import assert from "node:assert/strict";
import { isDate, isPositiveNumber, parseId, parseResourceFields } from "./validation.js";

test("resource fields allow only configured values", () => {
  const result = parseResourceFields(
    { name: "Widget", role: "admin" },
    ["name"],
    ["name"],
  );
  assert.deepEqual(result, { values: { name: "Widget" } });
});

test("resource fields reject missing required values and empty updates", () => {
  assert.equal(parseResourceFields({}, ["name"], ["name"]).error, "name is required.");
  assert.equal(parseResourceFields({ ignored: true }, ["name"]).error, "Provide at least one supported field.");
});

test("ids and positive numeric values are validated", () => {
  assert.equal(parseId("3"), 3);
  assert.equal(parseId("0"), null);
  assert.equal(parseId("1.2"), null);
  assert.equal(isPositiveNumber(1), true);
  assert.equal(isPositiveNumber(-1), false);
  assert.equal(isDate("2026-02-28"), true);
  assert.equal(isDate("2026-02-30"), false);
});
