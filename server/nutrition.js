// Shared calculation contract for API normalization and the meal confirmation UI.
export const nutritionPrompt = `识别图片是普通餐食还是包装食品营养成分表，返回 JSON：
{"source":"meal 或 label","label":"早餐/午餐/晚餐/加餐之一","note":"需要核对的简短说明","items":[{"name":"食物名","quantity":200,"unit":"g","basisAmount":100,"carbs":28,"protein":3,"fat":0.5,"energyKcal":null}]}
每项 carbs/protein/fat 都是 basisAmount 个 unit 对应的克数，不是整餐数值；quantity 是实际吃的数量。unit 只能是 g、ml、份。最多20项。
普通餐食：分开识别各食物，估算熟制后可食重量 quantity，使用 unit=g、basisAmount=100，按常见烹饪方式估算每100克营养（包含常规用油，不重复添加油脂），energyKcal=null，由程序汇总。不要把整餐营养重复给每一项。
营养表：source=label，整件包装食品作为一项，不把蛋白质等营养素拆成食物。严格读取同一列的营养数值：每100克使用100/g，每100毫升使用100/ml，每份使用1/份；不要混用不同列，不要把NRV百分比当克数。能量单位是kJ时除以4.184转成energyKcal，kcal则直接读取。碳水是总碳水，不要把糖再加一次。
标签能看清净含量时，可以把整包对应的数量填入quantity，并在note说明暂按整包、需确认实际吃了多少；每份表只有在明确读到每包份数时才按整包份数填quantity。无法确定食用量时quantity=null，要求用户补充；不要把每100克默认当成实际吃了100克。看不清的营养值、基准量、能量用null，不能猜，明确说明需要补充。未识别到餐食或营养表则items=[]并说明。只返回JSON。`;

export function decimal(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function itemValid(item) {
  return Boolean(item && typeof item.name === "string" && item.name.trim()) && ["g", "ml", "份"].includes(item.unit)
    && [item.quantity, item.basisAmount].every((x) => decimal(x) !== null && Number(x) > 0 && Number(x) <= 10000)
    && [item.carbs, item.protein, item.fat].every((x) => decimal(x) !== null && Number(x) <= 1000)
    && (decimal(item.energyKcal) === null ? item.energyKcal == null || item.energyKcal === "" : Number(item.energyKcal) <= 10000);
}

const tenth = (n) => Math.round(n * 10) / 10;
export function itemNutrition(item) {
  if (!itemValid(item)) return { carbs: 0, protein: 0, fat: 0, calories: 0 };
  const ratio = Number(item.quantity) / Number(item.basisAmount);
  const carbs = Number(item.carbs) * ratio;
  const protein = Number(item.protein) * ratio;
  const fat = Number(item.fat) * ratio;
  const calories = decimal(item.energyKcal) === null ? carbs * 4 + protein * 4 + fat * 9 : Number(item.energyKcal) * ratio;
  return { carbs, protein, fat, calories };
}

export function sumNutrition(items) {
  const sums = items.reduce((sum, item) => {
    const values = itemNutrition(item);
    for (const key of Object.keys(sum)) sum[key] += values[key];
    return sum;
  }, { carbs: 0, protein: 0, fat: 0, calories: 0 });
  return { carbs: tenth(sums.carbs), protein: tenth(sums.protein), fat: tenth(sums.fat), calories: Math.round(sums.calories) };
}

export function describeItems(items) {
  return items.map((item) => `${item.name || "未命名食物"} ${decimal(item.quantity) === null ? "待填写" : item.quantity}${item.unit}`).join("、");
}

export function normalizeAnalysis(result) {
  if (!Array.isArray(result?.items) || result.items.length === 0 || result.items.length > 20) throw new Error("no_food_items");
  const number = (value, max) => { const n = decimal(value); return n !== null && n <= max ? n : null; };
  const items = result.items.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("invalid_food_item");
    return {
      name: typeof raw.name === "string" ? raw.name.trim().slice(0, 300) : "",
      quantity: number(raw.quantity, 10000),
      unit: ["g", "ml", "份"].includes(raw.unit) ? raw.unit : "g",
      basisAmount: number(raw.basisAmount, 10000),
      carbs: number(raw.carbs, 1000), protein: number(raw.protein, 1000), fat: number(raw.fat, 1000),
      energyKcal: number(raw.energyKcal, 10000),
    };
  });
  return {
    source: result.source === "label" ? "label" : "meal",
    label: ["早餐", "午餐", "晚餐", "加餐"].includes(result.label) ? result.label : "",
    note: typeof result.note === "string" ? result.note.slice(0, 800) : "",
    items, foods: describeItems(items), ...sumNutrition(items),
  };
}
