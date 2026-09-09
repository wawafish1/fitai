import { test } from "node:test";
import assert from "node:assert/strict";
import { itemValid, sumNutrition, normalizeAnalysis, decimal } from "../server/nutrition.js";

const rice = { name: "熟米饭", unit: "g", quantity: 200, basisAmount: 100, carbs: 28, protein: 3, fat: 0.5, energyKcal: null };
test("quantity changes recalculate, rather than multiply already-scaled totals", () => {
  assert.deepEqual(sumNutrition([rice]), { carbs: 56, protein: 6, fat: 1, calories: 257 });
  assert.deepEqual(sumNutrition([{ ...rice, quantity: 100 }]), { carbs: 28, protein: 3, fat: 0.5, calories: 129 });
});
test("mixed foods sum at full precision before final rounding", () => {
  assert.deepEqual(sumNutrition([rice, { ...rice, name: "鸡肉", quantity: 150, carbs: 0, protein: 25, fat: 5 }]), { carbs: 56, protein: 43.5, fat: 8.5, calories: 475 });
});
test("label energy is preserved; per100g and per-serving are distinct", () => {
  assert.equal(sumNutrition([{ ...rice, quantity: 250, energyKcal: 836.8 / 4.184 }]).calories, 500);
  assert.deepEqual(sumNutrition([{ ...rice, unit: "份", basisAmount: 1, quantity: 0.5, energyKcal: 400 }]), { carbs: 14, protein: 1.5, fat: 0.3, calories: 200 });
  assert.equal(sumNutrition([{ ...rice, unit: "ml", quantity: 250, energyKcal: 40 }]).calories, 100);
});
test("blank or unreadable fields are not silently converted to zero", () => {
  for (const bad of [null, "", " ", "abc", -1, Infinity, true]) assert.equal(decimal(bad), null);
  for (const key of ["quantity", "basisAmount", "carbs", "protein", "fat"]) assert.equal(itemValid({ ...rice, [key]: null }), false);
  assert.equal(itemValid(null), false);
  assert.equal(itemValid({ ...rice, quantity: 0 }), false);
  assert.equal(itemValid({ ...rice, carbs: "bad" }), false);
  assert.equal(itemValid({ ...rice, carbs: 0, protein: 0, fat: 0, energyKcal: 0 }), true);
});
test("incomplete label keeps unknown quantity blank and excludes incomplete totals", () => {
  const result = normalizeAnalysis({ source: "label", note: "请填写食用量", items: [{ ...rice, quantity: null, carbs: null }] });
  assert.equal(result.items[0].quantity, null);
  assert.equal(result.items[0].carbs, null);
  assert.equal(result.calories, 0);
  assert.equal(result.source, "label");
});
test("bad provider payloads are rejected rather than saved as a phantom meal", () => {
  for (const result of [{}, { items: [] }, { items: [null] }, { items: Array(21).fill(rice) }]) assert.throws(() => normalizeAnalysis(result));
});
