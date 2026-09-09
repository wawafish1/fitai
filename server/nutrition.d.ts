export type FoodItem = {
  name: string;
  quantity: number | null;
  unit: "g" | "ml" | "份";
  basisAmount: number | null;
  carbs: number | null;
  protein: number | null;
  fat: number | null;
  energyKcal: number | null;
};
export type FoodItemInput = { [K in keyof FoodItem]: K extends "name" | "unit" ? FoodItem[K] : number | string | null };
export type Nutrition = { carbs: number; protein: number; fat: number; calories: number };
export function decimal(value: unknown): number | null;
export function itemValid(item: FoodItemInput): boolean;
export function itemNutrition(item: FoodItemInput): Nutrition;
export function sumNutrition(items: FoodItemInput[]): Nutrition;
export function describeItems(items: FoodItemInput[]): string;
export const nutritionPrompt: string;
export function normalizeAnalysis(value: unknown): {source: "label" | "meal"; label: string; note: string; items: FoodItem[]; foods: string} & Nutrition;
