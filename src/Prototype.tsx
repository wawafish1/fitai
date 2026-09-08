import { type ChangeEvent, type InputHTMLAttributes, useEffect, useRef, useState } from "react";
import {
  BarChartIcon,
  CalendarIcon,
  CameraIcon,
  CheckCircledIcon,
  ChevronRightIcon,
  Cross2Icon,
  HomeIcon,
  ImageIcon,
  InfoCircledIcon,
  MinusIcon,
  PersonIcon,
  PlusIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import { CircularProgressbar, buildStyles } from "react-circular-progressbar";
import { GenderFemale, GenderMale } from "@phosphor-icons/react";
import "react-circular-progressbar/dist/styles.css";
import { BottomSheet, KeyboardInput, MobileScroll, useKeyboard } from "./mobile";

type Tab = "today" | "trends" | "profile";
type BodyType = "easy-gain" | "balanced" | "easy-lean";
type MacroKey = "carbs" | "protein" | "fat";
type TrainingIntensity = "light" | "moderate" | "hard";
type DayMode = "training" | "rest";

type Profile = {
  name: string;
  sex: "male" | "female";
  age: number;
  height: number;
  weight: number;
  waist: number;
  bodyType: BodyType;
  carbMultiplier: number;
  proteinMultiplier: number;
  fatMultiplier: number;
  reviewDays: 10 | 15;
  trainingIntensity: TrainingIntensity;
  strengthMinutes: number;
  cardioMinutes: number;
  trainingDays: number;
  restDays: number;
  planStart: string;
  stageStart: string;
  stageId: string;
};

type Meal = {
  id: string;
  date: string;
  label: string;
  foods: string;
  time: string;
  carbs: number;
  protein: number;
  fat: number;
  calories: number;
  photoId?: string;
  isDemo?: boolean;
};

type CheckIn = {
  date: string;
  stageId: string;
  weight: number;
  waist: number;
  hunger: number;
  craving: number;
  energy: number;
  training: number;
  sleep: number;
  isDemo?: boolean;
};

type ReviewRecord = {
  id: string;
  date: string;
  stageStart: string;
  stageId: string;
  carbBefore: number;
  carbAfter: number;
  proteinBefore: number;
  proteinAfter: number;
  fatBefore: number;
  fatAfter: number;
  reason: string;
  weightChange: number;
  waistChange: number;
};

type AppData = {
  profile: Profile;
  meals: Meal[];
  checkIns: CheckIn[];
  reviewHistory: ReviewRecord[];
  dayModes: Record<string, DayMode>;
  demoMode: boolean;
};

type MealDraft = {
  label: string;
  foods: string;
  carbs: string;
  protein: string;
  fat: string;
  previewUrl: string;
};

type AuthUser = { email: string };
type AnalysisQuota = { used: number; limit: number };

type ProfileDraft = Omit<
  Profile,
  "age" | "height" | "weight" | "waist" | "carbMultiplier" | "proteinMultiplier" | "fatMultiplier" | "strengthMinutes" | "cardioMinutes"
> & {
  strengthMinutes: string;
  cardioMinutes: string;
  age: string;
  height: string;
  weight: string;
  waist: string;
  carbMultiplier: string;
  proteinMultiplier: string;
  fatMultiplier: string;
};

const STORAGE_KEY = "carb-stage-coach-v3";
const PHOTO_DB = "carb-stage-coach-photos";
const PHOTO_STORE = "photos";

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData
      ? init.headers
      : { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "request_failed") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

function AdaptiveInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [usesNativeKeyboard, setUsesNativeKeyboard] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 600px)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
    const syncMode = () => setUsesNativeKeyboard(media.matches);
    syncMode();
    media.addEventListener("change", syncMode);
    return () => media.removeEventListener("change", syncMode);
  }, []);

  return usesNativeKeyboard ? <input {...props} /> : <KeyboardInput {...props} />;
}

const round = (value: number) => Math.round(value);
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inRange(value: string | number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max;
}

function makeProfileDraft(profile: Profile): ProfileDraft {
  return {
    ...profile,
    strengthMinutes: String(profile.strengthMinutes),
    cardioMinutes: String(profile.cardioMinutes),
    age: String(profile.age),
    height: String(profile.height),
    weight: String(profile.weight),
    waist: String(profile.waist),
    carbMultiplier: String(profile.carbMultiplier),
    proteinMultiplier: String(profile.proteinMultiplier),
    fatMultiplier: String(profile.fatMultiplier),
  };
}

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function daysAgo(amount: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - amount);
  return dateKey(date);
}

function dayDiff(from: string, to = dateKey()) {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

function formatShortDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function createStageId() {
  return `stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeDefaultData(): AppData {
  const weightSeries = [76.2, 76.1, 75.9, 75.8, 75.7, 75.6];
  const waistSeries = [85.2, 85.1, 84.9, 84.8, 84.7, 84.6];
  return {
    profile: {
      name: "朋友",
      sex: "male",
      age: 30,
      height: 175,
      weight: 76,
      waist: 85,
      bodyType: "balanced",
      carbMultiplier: 3,
      proteinMultiplier: 1.6,
      fatMultiplier: 0.76,
      reviewDays: 10,
      trainingIntensity: "moderate",
      strengthMinutes: 45,
      cardioMinutes: 30,
      trainingDays: 3,
      restDays: 1,
      planStart: daysAgo(5),
      stageStart: daysAgo(5),
      stageId: "demo-stage",
    },
    meals: [
      {
        id: "demo-breakfast",
        date: dateKey(),
        label: "早餐",
        foods: "燕麦、鸡蛋、牛奶",
        time: "08:10",
        carbs: 34,
        protein: 26,
        fat: 13,
        calories: 357,
        isDemo: true,
      },
      {
        id: "demo-snack",
        date: dateKey(),
        label: "加餐",
        foods: "全麦面包、酸奶",
        time: "10:45",
        carbs: 38,
        protein: 28,
        fat: 14,
        calories: 390,
        isDemo: true,
      },
      {
        id: "demo-lunch",
        date: dateKey(),
        label: "午餐",
        foods: "鸡胸肉、糙米、西兰花、南瓜",
        time: "12:36",
        carbs: 54,
        protein: 38,
        fat: 16,
        calories: 512,
        isDemo: true,
      },
    ],
    checkIns: weightSeries.map((weight, index) => ({
      date: daysAgo(weightSeries.length - index - 1),
      stageId: "demo-stage",
      weight,
      waist: waistSeries[index],
      hunger: 3,
      craving: 3,
      energy: 4,
      training: 4,
      sleep: 4,
      isDemo: true,
    })),
    reviewHistory: [],
    dayModes: {},
    demoMode: true,
  };
}

function loadData(): AppData {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return makeDefaultData();
    const parsed = JSON.parse(saved) as Partial<AppData>;
    if (!parsed.profile) return makeDefaultData();
    const defaults = makeDefaultData();
    const rawProfile = parsed.profile as Partial<Profile>;
    const stageId = rawProfile.stageId || "stage-initial";
    const meals = (Array.isArray(parsed.meals) ? parsed.meals : [])
      .filter((meal) => meal && typeof meal === "object")
      .map((meal, index): Meal => {
        const carbs = clamp(finiteNumber(meal.carbs), 0, 500);
        const protein = clamp(finiteNumber(meal.protein), 0, 300);
        const fat = clamp(finiteNumber(meal.fat), 0, 300);
        return {
          id: typeof meal.id === "string" ? meal.id : `meal-recovered-${index}`,
          date: typeof meal.date === "string" ? meal.date : dateKey(),
          label: typeof meal.label === "string" ? meal.label : "餐食",
          foods: typeof meal.foods === "string" ? meal.foods : "未命名餐食",
          time: typeof meal.time === "string" ? meal.time : "--:--",
          carbs,
          protein,
          fat,
          calories: clamp(finiteNumber(meal.calories, macroCalories(carbs, protein, fat)), 0, 10_000),
          photoId: typeof meal.photoId === "string" ? meal.photoId : undefined,
          isDemo: meal.isDemo === true,
        };
      });
    const checkIns = (Array.isArray(parsed.checkIns) ? parsed.checkIns : [])
      .filter((item) => item && typeof item.date === "string")
      .map((item): CheckIn => ({
        ...item,
        stageId: item.stageId || stageId,
        weight: clamp(finiteNumber(item.weight, rawProfile.weight || defaults.profile.weight), 30, 300),
        waist: clamp(finiteNumber(item.waist, rawProfile.waist || defaults.profile.waist), 40, 200),
        hunger: clamp(round(finiteNumber(item.hunger, 3)), 1, 5),
        craving: clamp(round(finiteNumber(item.craving, 3)), 1, 5),
        energy: clamp(round(finiteNumber(item.energy, 3)), 1, 5),
        training: clamp(round(finiteNumber(item.training, 3)), 1, 5),
        sleep: clamp(round(finiteNumber(item.sleep, 3)), 1, 5),
        isDemo: item.isDemo === true,
      }));
    const profile: Profile = {
      ...defaults.profile,
      ...rawProfile,
      name: typeof rawProfile.name === "string" ? rawProfile.name : defaults.profile.name,
      sex: rawProfile.sex === "female" ? "female" : "male",
      age: clamp(round(finiteNumber(rawProfile.age, defaults.profile.age)), 18, 80),
      bodyType: ["easy-gain", "balanced", "easy-lean"].includes(rawProfile.bodyType || "")
        ? rawProfile.bodyType as BodyType
        : defaults.profile.bodyType,
      height: clamp(finiteNumber(rawProfile.height, defaults.profile.height), 100, 230),
      weight: clamp(finiteNumber(rawProfile.weight, defaults.profile.weight), 30, 300),
      waist: clamp(finiteNumber(rawProfile.waist, defaults.profile.waist), 40, 200),
      reviewDays: rawProfile.reviewDays === 15 ? 15 : 10,
      trainingIntensity: ["light", "moderate", "hard"].includes(rawProfile.trainingIntensity || "")
        ? rawProfile.trainingIntensity as TrainingIntensity
        : defaults.profile.trainingIntensity,
      strengthMinutes: clamp(round(finiteNumber(rawProfile.strengthMinutes, defaults.profile.strengthMinutes)), 0, 300),
      cardioMinutes: clamp(round(finiteNumber(rawProfile.cardioMinutes, defaults.profile.cardioMinutes)), 0, 300),
      trainingDays: clamp(round(finiteNumber(rawProfile.trainingDays, defaults.profile.trainingDays)), 1, 6),
      restDays: clamp(round(finiteNumber(rawProfile.restDays, defaults.profile.restDays)), 1, 3),
      planStart: rawProfile.planStart || rawProfile.stageStart || dateKey(),
      stageStart: rawProfile.stageStart || dateKey(),
      stageId,
      carbMultiplier: clamp(
        finiteNumber(rawProfile.carbMultiplier, defaults.profile.carbMultiplier),
        2,
        5,
      ),
      proteinMultiplier: clamp(
        finiteNumber(rawProfile.proteinMultiplier, defaults.profile.proteinMultiplier),
        1.2,
        2,
      ),
      fatMultiplier: clamp(
        finiteNumber(rawProfile.fatMultiplier, defaults.profile.fatMultiplier),
        0.6,
        0.8,
      ),
    };
    const reviewHistory = (Array.isArray(parsed.reviewHistory) ? parsed.reviewHistory : []).map(
      (review, index): ReviewRecord => ({
        ...review,
        id: typeof review.id === "string" ? review.id : `review-recovered-${index}`,
        date: typeof review.date === "string" ? review.date : dateKey(),
        stageStart: typeof review.stageStart === "string" ? review.stageStart : profile.stageStart,
        stageId: review.stageId || `legacy-review-${index}`,
        carbBefore: clamp(finiteNumber(review.carbBefore, profile.carbMultiplier), 2, 5),
        carbAfter: clamp(finiteNumber(review.carbAfter, profile.carbMultiplier), 2, 5),
        proteinBefore: clamp(finiteNumber(review.proteinBefore, profile.proteinMultiplier), 1.2, 2),
        proteinAfter: clamp(finiteNumber(review.proteinAfter, profile.proteinMultiplier), 1.2, 2),
        fatBefore: clamp(finiteNumber(review.fatBefore, profile.fatMultiplier), 0.6, 0.8),
        fatAfter: clamp(finiteNumber(review.fatAfter, profile.fatMultiplier), 0.6, 0.8),
        reason: typeof review.reason === "string" ? review.reason : "阶段复盘",
        weightChange: finiteNumber(review.weightChange),
        waistChange: finiteNumber(review.waistChange),
      }),
    );
    return {
      demoMode: typeof parsed.demoMode === "boolean" ? parsed.demoMode : false,
      profile,
      meals,
      checkIns,
      reviewHistory,
      dayModes: parsed.dayModes && typeof parsed.dayModes === "object"
        ? Object.fromEntries(Object.entries(parsed.dayModes).filter(([, mode]) => mode === "training" || mode === "rest"))
        : {},
    };
  } catch {
    return makeDefaultData();
  }
}

function openPhotoDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PHOTO_STORE)) {
        request.result.createObjectStore(PHOTO_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storePhoto(id: string, blob: Blob) {
  const db = await openPhotoDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getPhoto(id: string) {
  const db = await openPhotoDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = db.transaction(PHOTO_STORE, "readonly").objectStore(PHOTO_STORE).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob;
}

async function clearPhotos() {
  const db = await openPhotoDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function compressPhoto(file: File) {
  return new Promise<{ blob: Blob; url: string }>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const maxEdge = 960;
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) return reject(new Error("图片压缩失败"));
          resolve({ blob, url: URL.createObjectURL(blob) });
        },
        "image/jpeg",
        0.76,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取图片"));
    };
    image.src = objectUrl;
  });
}

function macroCalories(carbs: number, protein: number, fat: number) {
  return round(carbs * 4 + protein * 4 + fat * 9);
}

function restingEnergy(profile: Profile, weight: number) {
  const sexConstant = profile.sex === "male" ? 5 : -161;
  return 10 * weight + 6.25 * profile.height - 5 * profile.age + sexConstant;
}

function exerciseEnergy(weight: number, minutes: number, mets: number) {
  return Math.max(0, (mets - 1) * 3.5 * weight / 200 * minutes);
}

function energyEstimate(profile: Profile, weight: number) {
  const base = Math.max(0, restingEnergy(profile, weight) * 1.2);
  const strengthMets = { light: 3.5, moderate: 5, hard: 6 }[profile.trainingIntensity];
  const cardioMets = { light: 4, moderate: 6, hard: 8 }[profile.trainingIntensity];
  const exercise = exerciseEnergy(weight, profile.strengthMinutes, strengthMets)
    + exerciseEnergy(weight, profile.cardioMinutes, cardioMets);
  const trainingDay = base + exercise;
  const restDay = base;
  const cycleDays = profile.trainingDays + profile.restDays;
  const averageDay = (trainingDay * profile.trainingDays + restDay * profile.restDays) / cycleDays;
  return { base: round(base), exercise: round(exercise), trainingDay: round(trainingDay), restDay: round(restDay), averageDay: round(averageDay) };
}

function average(items: number[]) {
  return items.length ? items.reduce((sum, item) => sum + item, 0) / items.length : 0;
}

function getAdvice(checkIns: CheckIn[]) {
  const recent = checkIns.slice(-15);
  if (recent.length < 3) {
    return {
      tone: "wait",
      title: "继续记录身体状态",
      detail: "至少记录 3 天后，建议才会更可靠。",
      carbDelta: 0,
      proteinDelta: 0,
    };
  }
  const hunger = average(recent.map((item) => item.hunger));
  const craving = average(recent.map((item) => item.craving));
  const state = average(recent.flatMap((item) => [item.energy, item.training, item.sleep]));
  const weakestState = Math.min(
    ...recent.flatMap((item) => [item.energy, item.training, item.sleep]),
  );
  const first = recent[0];
  const last = recent.at(-1)!;
  const weightChange = last.weight - first.weight;
  const waistChange = last.waist - first.waist;
  const trendText = `本阶段体重 ${weightChange > 0 ? "+" : ""}${weightChange.toFixed(1)}kg、腰围 ${waistChange > 0 ? "+" : ""}${waistChange.toFixed(1)}cm。`;
  const progressContinues = weightChange <= -0.3 || waistChange <= -0.5;

  if (weakestState <= 2 || state < 2.7) {
    return {
      tone: "caution",
      title: "先维持，排查恢复状态",
      detail: `精神、训练或睡眠有明显低点，先不要急着降低碳水。${trendText}`,
      carbDelta: 0,
      proteinDelta: 0,
    };
  }
  if (hunger >= 4 && craving >= 4) {
    return {
      tone: "up",
      title: "碳水可小幅上调",
      detail: `饥饿和干净碳水渴望较强，且整体状态稳定。${trendText}`,
      carbDelta: 0.5,
      proteinDelta: -0.1,
    };
  }
  if (hunger <= 2.2 && craving <= 2.2) {
    if (progressContinues) {
      return {
        tone: "steady",
        title: "趋势仍在变化，先维持",
        detail: `当前不太饿，但体重或腰围仍在下降，先保持这一阶段。${trendText}`,
        carbDelta: 0,
        proteinDelta: 0,
      };
    }
    return {
      tone: "down",
      title: "碳水可小幅下调",
      detail: `饥饿感和碳水渴望偏低，且体重腰围变化不明显，可进入下一段观察。${trendText}`,
      carbDelta: -0.5,
      proteinDelta: 0.1,
    };
  }
  return {
    tone: "steady",
    title: "状态稳定，保持当前碳水",
    detail: `维持微微饥饿、精神和训练状态良好的节奏。${trendText}`,
    carbDelta: 0,
    proteinDelta: 0,
  };
}

function scoreLabel(value: number) {
  if (value <= 2) return "偏低";
  if (value === 3) return "适中";
  return "很好";
}

function MacroProgress({
  label,
  value,
  target,
  color,
}: {
  label: string;
  value: number;
  target: number;
  color: string;
}) {
  const percent = clamp(Math.round((value / Math.max(target, 1)) * 100), 0, 100);
  return (
    <div className="macro-progress">
      <div className="macro-ring">
        <CircularProgressbar
          value={percent}
          styles={buildStyles({
            pathColor: color,
            trailColor: "#edf0ea",
            strokeLinecap: "round",
            pathTransitionDuration: 0.6,
          })}
        />
        <div className="macro-ring-label">
          <strong>{round(value)}</strong>
          <span>/ {round(target)}g</span>
        </div>
      </div>
      <span className="macro-name">{label}</span>
      <span className="macro-percent" style={{ color }}>
        {percent}%
      </span>
    </div>
  );
}

export default function Prototype() {
  const keyboard = useKeyboard();
  const [data, setData] = useState<AppData>(loadData);
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [quota, setQuota] = useState<AnalysisQuota>({ used: 0, limit: 10 });
  const syncReadyRef = useRef(false);
  const [tab, setTab] = useState<Tab>("today");
  const [mealOpen, setMealOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [mealError, setMealError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [checkInError, setCheckInError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [analysisMode, setAnalysisMode] = useState<"idle" | "analyzing" | "ai" | "manual">("idle");
  const [mealSaving, setMealSaving] = useState(false);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const mealSavingRef = useRef(false);
  const analysisRequestRef = useRef(0);
  const [mealDraft, setMealDraft] = useState<MealDraft>({
    label: "午餐",
    foods: "",
    carbs: "",
    protein: "",
    fat: "",
    previewUrl: "",
  });
  const [checkInDraft, setCheckInDraft] = useState({
    weight: String(data.profile.weight),
    waist: String(data.profile.waist),
    hunger: 3,
    craving: 3,
    energy: 4,
    training: 4,
    sleep: 4,
  });
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(() => makeProfileDraft(data.profile));

  useEffect(() => {
    try {
      const key = authUser ? `${STORAGE_KEY}:${authUser.email}` : STORAGE_KEY;
      window.localStorage.setItem(key, JSON.stringify(data));
      setStorageError("");
    } catch {
      setStorageError("当前浏览器未能保存数据，请检查隐私模式或存储空间。");
    }
  }, [authUser, data]);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const session = await apiJson<{ user: AuthUser; analysis: AnalysisQuota }>("/api/auth/me");
        if (!active) return;
        setAuthUser(session.user);
        setQuota(session.analysis);
        const saved = await apiJson<{ data: AppData | null }>("/api/data");
        if (!active) return;
        if (saved.data?.profile) {
          setData(saved.data);
          setProfileDraft(makeProfileDraft(saved.data.profile));
        } else {
          const userLocal = window.localStorage.getItem(`${STORAGE_KEY}:${session.user.email}`);
          const candidate = userLocal ? JSON.parse(userLocal) as AppData : data;
          if (candidate?.profile) {
            setData(candidate);
            setProfileDraft(makeProfileDraft(candidate.profile));
            await apiJson("/api/data", { method: "PUT", body: JSON.stringify({ data: candidate }) });
          }
        }
        window.localStorage.removeItem(STORAGE_KEY);
        syncReadyRef.current = true;
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (active && status !== 401) setAuthError("暂时无法连接服务器，请稍后重试。");
      } finally {
        if (active) setAuthLoading(false);
      }
    };
    void initialize();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!authUser || !syncReadyRef.current) return;
    const timer = window.setTimeout(() => {
      apiJson("/api/data", { method: "PUT", body: JSON.stringify({ data }) })
        .then(() => setStorageError(""))
        .catch(() => setStorageError("记录已保存在当前设备，暂时未同步到账号。"));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [authUser, data]);

  useEffect(() => {
    const photoMeals = data.meals.filter((meal) => meal.photoId && !photoUrls[meal.id]);
    if (!photoMeals.length) return;
    let active = true;
    Promise.all(
      photoMeals.map(async (meal) => {
        let blob = await getPhoto(meal.photoId!);
        if (!blob && authUser) {
          const response = await fetch(`/api/photos/${encodeURIComponent(meal.photoId!)}`);
          if (response.ok) blob = await response.blob();
        }
        return blob ? ([meal.id, URL.createObjectURL(blob)] as const) : null;
      }),
    )
      .then((items) => {
        if (!active) return;
        setPhotoUrls((current) => ({
          ...current,
          ...Object.fromEntries(items.filter(Boolean) as [string, string][]),
        }));
      })
      .catch(() => {
        if (active) setStorageError("餐食照片暂时无法读取，其余记录仍可正常使用。");
      });
    return () => {
      active = false;
    };
  }, [authUser, data.meals]);

  const today = dateKey();
  const todayMeals = data.meals.filter((meal) => meal.date === today);
  const totals = todayMeals.reduce(
    (sum, meal) => ({
      carbs: sum.carbs + meal.carbs,
      protein: sum.protein + meal.protein,
      fat: sum.fat + meal.fat,
      calories: sum.calories + meal.calories,
    }),
    { carbs: 0, protein: 0, fat: 0, calories: 0 },
  );
  const sortedCheckIns = [...data.checkIns].sort((a, b) => a.date.localeCompare(b.date));
  const latestCheckIn = sortedCheckIns.at(-1);
  const stageCheckIns = sortedCheckIns.filter((item) => item.stageId === data.profile.stageId);
  const stageFirstCheckIn = stageCheckIns[0];
  const stageLatestCheckIn = stageCheckIns.at(-1);
  const currentWeight = latestCheckIn?.weight || data.profile.weight;
  const targets = {
    carbs: currentWeight * data.profile.carbMultiplier,
    protein: currentWeight * data.profile.proteinMultiplier,
    fat: currentWeight * data.profile.fatMultiplier,
  };
  const expenditure = energyEstimate(data.profile, currentWeight);
  const cyclePosition = dayDiff(data.profile.planStart) % (data.profile.trainingDays + data.profile.restDays);
  const scheduledDayMode: DayMode = cyclePosition < data.profile.trainingDays ? "training" : "rest";
  const todayMode = data.dayModes[today] || scheduledDayMode;
  const todayExercise = todayMode === "training" ? expenditure.exercise : 0;
  const todayExpenditure = expenditure.base + todayExercise;
  const planElapsedDays = dayDiff(data.profile.planStart) + 1;
  const planDay = Math.min(90, planElapsedDays);
  const planComplete = planElapsedDays >= 90;
  const stageDay = dayDiff(data.profile.stageStart) + 1;
  const daysUntilReview = Math.max(0, data.profile.reviewDays - stageDay);
  const advice = getAdvice(stageCheckIns);
  const recentMeal = todayMeals.at(-1) || data.meals.at(-1);
  const missingStageCheckIns = Math.max(0, 7 - stageCheckIns.length);
  const canReview = daysUntilReview === 0 && missingStageCheckIns === 0;
  const stageWeightChange = stageFirstCheckIn && stageLatestCheckIn ? stageLatestCheckIn.weight - stageFirstCheckIn.weight : 0;
  const stageWaistChange = stageFirstCheckIn && stageLatestCheckIn ? stageLatestCheckIn.waist - stageFirstCheckIn.waist : 0;
  const mealMacroValues = [mealDraft.carbs, mealDraft.protein, mealDraft.fat].map(Number);
  const mealDraftValid =
    Boolean(mealDraft.foods.trim()) &&
    mealMacroValues.every((value) => Number.isFinite(value) && value >= 0 && value <= 500) &&
    mealMacroValues.some((value) => value > 0);
  const checkInDraftValid =
    inRange(checkInDraft.weight, 30, 300) && inRange(checkInDraft.waist, 40, 200);
  const draftProfileForEstimate: Profile = {
    ...data.profile,
    ...profileDraft,
    strengthMinutes: finiteNumber(profileDraft.strengthMinutes),
    cardioMinutes: finiteNumber(profileDraft.cardioMinutes),
    age: finiteNumber(profileDraft.age, data.profile.age),
    height: finiteNumber(profileDraft.height, data.profile.height),
    weight: finiteNumber(profileDraft.weight, currentWeight),
    waist: finiteNumber(profileDraft.waist, data.profile.waist),
    carbMultiplier: finiteNumber(profileDraft.carbMultiplier, data.profile.carbMultiplier),
    proteinMultiplier: finiteNumber(profileDraft.proteinMultiplier, data.profile.proteinMultiplier),
    fatMultiplier: finiteNumber(profileDraft.fatMultiplier, data.profile.fatMultiplier),
  };
  const draftExpenditure = energyEstimate(draftProfileForEstimate, draftProfileForEstimate.weight);
  const draftTargetCalories = macroCalories(
    draftProfileForEstimate.weight * draftProfileForEstimate.carbMultiplier,
    draftProfileForEstimate.weight * draftProfileForEstimate.proteinMultiplier,
    draftProfileForEstimate.weight * draftProfileForEstimate.fatMultiplier,
  );
  const profileDraftValid =
    [profileDraft.strengthMinutes, profileDraft.cardioMinutes].every((value) =>
      value.trim() !== "" && inRange(value, 0, 300) && Number.isInteger(Number(value)),
    ) &&
    inRange(profileDraft.age, 18, 80) &&
    inRange(profileDraft.height, 100, 230) &&
    inRange(profileDraft.weight, 30, 300) &&
    inRange(profileDraft.waist, 40, 200) &&
    inRange(profileDraft.carbMultiplier, 2, 5) &&
    inRange(profileDraft.proteinMultiplier, 1.2, 2) &&
    inRange(profileDraft.fatMultiplier, 0.6, 0.8);

  const editMealDraft = (patch: Partial<MealDraft>) => {
    analysisRequestRef.current += 1;
    setAnalysisMode("manual");
    setMealDraft((current) => ({ ...current, ...patch }));
  };

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const requestId = ++analysisRequestRef.current;
    try {
      setMealError("");
      const compressed = await compressPhoto(file);
      if (requestId !== analysisRequestRef.current) return;
      setPhotoBlob(compressed.blob);
      setMealDraft({
        label: new Date().getHours() < 10 ? "早餐" : new Date().getHours() < 16 ? "午餐" : "晚餐",
        foods: "",
        carbs: "",
        protein: "",
        fat: "",
        previewUrl: compressed.url,
      });
      setMealOpen(true);
      setAnalysisMode("analyzing");

      const endpoint = import.meta.env.VITE_AI_MEAL_ENDPOINT || "/api/analyze-meal";
      const form = new FormData();
      form.append("image", compressed.blob, "meal.jpg");
      const response = await fetch(endpoint, { method: "POST", body: form });
      const result = (await response.json()) as Partial<Meal> & { error?: string; analysis?: AnalysisQuota };
      if (!response.ok) {
        if (response.status === 429) setMealError("今天的 10 次 AI 识别额度已用完，明天零点后恢复。");
        else if (response.status === 401) setMealError("登录状态已过期，请重新登录。");
        throw new Error(result.error || "AI endpoint unavailable");
      }
      if (result.analysis) setQuota(result.analysis);
      if (requestId !== analysisRequestRef.current) return;
      const analyzedCarbs = clamp(finiteNumber(result.carbs), 0, 500);
      const analyzedProtein = clamp(finiteNumber(result.protein), 0, 300);
      const analyzedFat = clamp(finiteNumber(result.fat), 0, 300);
      setMealDraft((current) => ({
        ...current,
        label: result.label || current.label,
        foods: result.foods || "",
        carbs: analyzedCarbs ? String(analyzedCarbs) : "",
        protein: analyzedProtein ? String(analyzedProtein) : "",
        fat: analyzedFat ? String(analyzedFat) : "",
      }));
      setAnalysisMode("ai");
    } catch {
      if (requestId === analysisRequestRef.current) setAnalysisMode("manual");
    }
  };

  const saveMeal = async () => {
    if (mealSavingRef.current) return;
    if (!mealDraftValid) {
      setMealError("请填写食物，并至少填写一项有效的三大营养素。");
      return;
    }
    mealSavingRef.current = true;
    setMealSaving(true);
    const [carbs, protein, fat] = mealMacroValues;
    const id = `meal-${Date.now()}`;
    try {
      if (photoBlob) {
        await storePhoto(id, photoBlob);
        const form = new FormData();
        form.append("image", photoBlob, "meal.jpg");
        await apiJson(`/api/photos/${id}`, { method: "PUT", body: form });
      }
    } catch {
      setMealError("照片暂时无法保存，请稍后重试。");
      mealSavingRef.current = false;
      setMealSaving(false);
      return;
    }
    const now = new Date();
    const nextMeal: Meal = {
      id,
      date: today,
      label: mealDraft.label,
      foods: mealDraft.foods.trim(),
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      carbs,
      protein,
      fat,
      calories: macroCalories(carbs, protein, fat),
      photoId: photoBlob ? id : undefined,
    };
    const firstRealEntry = data.demoMode;
    const firstStageId = firstRealEntry ? createStageId() : data.profile.stageId;
    setData((current) => {
      const initializing = current.demoMode;
      return {
        ...current,
        demoMode: false,
        profile: initializing
          ? {
              ...current.profile,
              planStart: today,
              stageStart: today,
              stageId: firstStageId,
            }
          : current.profile,
        meals: [...current.meals.filter((meal) => !meal.isDemo), nextMeal],
        checkIns: initializing ? current.checkIns.filter((item) => !item.isDemo) : current.checkIns,
        reviewHistory: initializing ? [] : current.reviewHistory,
      };
    });
    if (firstRealEntry) {
      setProfileDraft((current) => ({
        ...current,
        planStart: today,
        stageStart: today,
        stageId: firstStageId,
      }));
    }
    if (keyboard.visible) keyboard.hide();
    setMealOpen(false);
    setAnalysisMode("idle");
    setMealError("");
    setPhotoBlob(null);
    mealSavingRef.current = false;
    setMealSaving(false);
  };

  const openCheckInForm = () => {
    const source = stageCheckIns.find((item) => item.date === today) || latestCheckIn;
    setCheckInDraft({
      weight: String(source?.weight ?? data.profile.weight),
      waist: String(source?.waist ?? data.profile.waist),
      hunger: source?.hunger ?? 3,
      craving: source?.craving ?? 3,
      energy: source?.energy ?? 4,
      training: source?.training ?? 4,
      sleep: source?.sleep ?? 4,
    });
    setCheckInError("");
    setCheckInOpen(true);
  };

  const saveCheckIn = () => {
    if (!checkInDraftValid) {
      setCheckInError("请检查体重和腰围：体重 30–300kg，腰围 40–200cm。");
      return;
    }
    const firstRealEntry = data.demoMode;
    const firstStageId = firstRealEntry ? createStageId() : data.profile.stageId;
    setData((current) => {
      const initializing = current.demoMode;
      const activeStageId = initializing ? firstStageId : current.profile.stageId;
      const next: CheckIn = {
        date: today,
        stageId: activeStageId,
        weight: Number(checkInDraft.weight),
        waist: Number(checkInDraft.waist),
        hunger: checkInDraft.hunger,
        craving: checkInDraft.craving,
        energy: checkInDraft.energy,
        training: checkInDraft.training,
        sleep: checkInDraft.sleep,
      };
      return {
        ...current,
        demoMode: false,
        profile: initializing
          ? {
              ...current.profile,
              planStart: today,
              stageStart: today,
              stageId: activeStageId,
            }
          : current.profile,
        meals: initializing ? current.meals.filter((meal) => !meal.isDemo) : current.meals,
        checkIns: [
          ...current.checkIns.filter(
            (item) => !item.isDemo && (item.date !== today || item.stageId !== activeStageId),
          ),
          next,
        ].sort((a, b) => a.date.localeCompare(b.date)),
        reviewHistory: initializing ? [] : current.reviewHistory,
      };
    });
    if (firstRealEntry) {
      setProfileDraft((current) => ({
        ...current,
        planStart: today,
        stageStart: today,
        stageId: firstStageId,
      }));
    }
    if (keyboard.visible) keyboard.hide();
    setCheckInError("");
    setCheckInOpen(false);
  };

  const saveProfile = () => {
    if (![profileDraft.strengthMinutes, profileDraft.cardioMinutes].every((value) =>
      value.trim() !== "" && inRange(value, 0, 300) && Number.isInteger(Number(value)),
    )) {
      setProfileError("训练时长请填写 0–300 的整数分钟，不训练可填 0。");
      return;
    }
    if (!profileDraftValid) {
      setProfileError("请检查各项数值是否在页面标注的范围内。");
      return;
    }
    const startingFromDemo = data.demoMode;
    const coefficientsChanged =
      Number(profileDraft.carbMultiplier) !== data.profile.carbMultiplier ||
      Number(profileDraft.proteinMultiplier) !== data.profile.proteinMultiplier ||
      Number(profileDraft.fatMultiplier) !== data.profile.fatMultiplier;
    const startsNewStage = startingFromDemo || coefficientsChanged;
    const normalized: Profile = {
      ...profileDraft,
      strengthMinutes: Number(profileDraft.strengthMinutes),
      cardioMinutes: Number(profileDraft.cardioMinutes),
      age: Number(profileDraft.age),
      height: Number(profileDraft.height),
      weight: Number(profileDraft.weight),
      waist: Number(profileDraft.waist),
      carbMultiplier: Number(profileDraft.carbMultiplier),
      proteinMultiplier: Number(profileDraft.proteinMultiplier),
      fatMultiplier: Number(profileDraft.fatMultiplier),
      planStart: startingFromDemo ? today : profileDraft.planStart,
      stageStart: startsNewStage ? today : profileDraft.stageStart,
      stageId: startsNewStage ? createStageId() : data.profile.stageId,
    };
    const manualReview: ReviewRecord = {
      id: `review-${Date.now()}`,
      date: today,
      stageStart: data.profile.stageStart,
      stageId: data.profile.stageId,
      carbBefore: data.profile.carbMultiplier,
      carbAfter: normalized.carbMultiplier,
      proteinBefore: data.profile.proteinMultiplier,
      proteinAfter: normalized.proteinMultiplier,
      fatBefore: data.profile.fatMultiplier,
      fatAfter: normalized.fatMultiplier,
      reason: "手动调整营养目标",
      weightChange: stageWeightChange,
      waistChange: stageWaistChange,
    };
    setData((current) => ({
      ...current,
      demoMode: false,
      profile: normalized,
      meals: current.meals.filter((meal) => !meal.isDemo),
      checkIns: current.checkIns.filter((item) => !item.isDemo),
      reviewHistory: startingFromDemo
        ? []
        : coefficientsChanged
          ? [...current.reviewHistory, manualReview]
          : current.reviewHistory,
    }));
    setProfileDraft(makeProfileDraft(normalized));
    if (keyboard.visible) keyboard.hide();
    setProfileError("");
    setProfileSaved(true);
    window.setTimeout(() => setProfileSaved(false), 1600);
  };

  const setTodayMode = (mode: DayMode) => {
    setData((current) => ({
      ...current,
      dayModes: { ...current.dayModes, [today]: mode },
    }));
  };

  const applyReview = () => {
    if (!canReview) return;
    const carbAfter = clamp(data.profile.carbMultiplier + advice.carbDelta, 2, 5);
    const proteinAfter = clamp(data.profile.proteinMultiplier + advice.proteinDelta, 1.2, 2);
    const nextProfile: Profile = {
      ...data.profile,
      carbMultiplier: carbAfter,
      proteinMultiplier: proteinAfter,
      stageStart: today,
      stageId: createStageId(),
    };
    const review: ReviewRecord = {
      id: `review-${Date.now()}`,
      date: today,
      stageStart: data.profile.stageStart,
      stageId: data.profile.stageId,
      carbBefore: data.profile.carbMultiplier,
      carbAfter,
      proteinBefore: data.profile.proteinMultiplier,
      proteinAfter,
      fatBefore: data.profile.fatMultiplier,
      fatAfter: data.profile.fatMultiplier,
      reason: advice.title,
      weightChange: stageWeightChange,
      waistChange: stageWaistChange,
    };
    setData((current) => ({
      ...current,
      profile: nextProfile,
      reviewHistory: [...current.reviewHistory, review],
    }));
    setProfileDraft(makeProfileDraft(nextProfile));
    setReviewOpen(false);
  };

  const resetDemo = async () => {
    if (!window.confirm("这会清除当前设备上的计划、记录和餐食照片，并恢复示例数据。确定继续吗？")) return;
    try {
      await clearPhotos();
    } catch {
      setStorageError("餐食照片未能完全清除，请检查浏览器存储设置。");
      return;
    }
    const fresh = makeDefaultData();
    setData(fresh);
    setProfileDraft(makeProfileDraft(fresh.profile));
    setMealError("");
    setProfileError("");
    setCheckInError("");
    setTab("today");
  };

  const requestLoginCode = async () => {
    const email = loginEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthError("请输入正确的邮箱地址。");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      await apiJson("/api/auth/request-code", { method: "POST", body: JSON.stringify({ email }) });
      setLoginEmail(email);
      setCodeSent(true);
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      setAuthError(status === 429 ? "验证码发送得太频繁，请一分钟后再试。" : "验证码发送失败，请稍后重试。");
    } finally {
      setAuthBusy(false);
    }
  };

  const verifyLoginCode = async () => {
    if (!/^\d{6}$/.test(loginCode.trim())) {
      setAuthError("请输入邮件中的 6 位验证码。");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      const result = await apiJson<{ user: AuthUser; analysis: AnalysisQuota }>("/api/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({ email: loginEmail, code: loginCode.trim() }),
      });
      const saved = await apiJson<{ data: AppData | null }>("/api/data");
      const userLocal = window.localStorage.getItem(`${STORAGE_KEY}:${result.user.email}`);
      const candidate = saved.data?.profile
        ? saved.data
        : userLocal
          ? JSON.parse(userLocal) as AppData
          : data;
      setAuthUser(result.user);
      setQuota(result.analysis);
      if (candidate?.profile) {
        setData(candidate);
        setProfileDraft(makeProfileDraft(candidate.profile));
        if (!saved.data) await apiJson("/api/data", { method: "PUT", body: JSON.stringify({ data: candidate }) });
      }
      window.localStorage.removeItem(STORAGE_KEY);
      syncReadyRef.current = true;
    } catch {
      setAuthError("验证码不正确或已经过期，请重新获取。");
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = async () => {
    try { await apiJson("/api/auth/logout", { method: "POST", body: "{}" }); } catch { /* session may already be gone */ }
    syncReadyRef.current = false;
    setAuthUser(null);
    setCodeSent(false);
    setLoginCode("");
    const fresh = makeDefaultData();
    setData(fresh);
    setProfileDraft(makeProfileDraft(fresh.profile));
  };

  if (authLoading) {
    return <div className="nutrition-app auth-shell"><div className="auth-loading"><ReloadIcon className="spin" />正在连接轻盈计划…</div></div>;
  }

  if (!authUser) {
    return (
      <div className="nutrition-app auth-shell">
        <MobileScroll className="app-screen">
          <main className="auth-screen" aria-label="邮箱登录">
            <div className="auth-brand"><span>轻</span><div><strong>轻盈计划</strong><small>三个月饮食与身体记录</small></div></div>
            <section className="auth-card">
              <p className="eyebrow">欢迎回来</p>
              <h1>邮箱验证码登录</h1>
              <p className="auth-description">首次验证会自动创建账号，记录会安全地保存在你的账号中。</p>
              <label className="field-label-custom">邮箱地址
                <AdaptiveInput type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" value={loginEmail} disabled={codeSent} onChange={(event) => setLoginEmail(event.target.value)} />
              </label>
              {codeSent && <label className="field-label-custom">6 位验证码
                <AdaptiveInput inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="请输入邮件验证码" value={loginCode} onChange={(event) => setLoginCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
              </label>}
              {authError && <p className="form-error" role="alert">{authError}</p>}
              <button className="primary-button" disabled={authBusy} onClick={codeSent ? verifyLoginCode : requestLoginCode}>
                {authBusy ? "请稍候…" : codeSent ? "验证并登录" : "获取验证码"}
              </button>
              {codeSent && <button className="secondary-button" disabled={authBusy} onClick={() => { setCodeSent(false); setLoginCode(""); setAuthError(""); }}>更换邮箱</button>}
              <p className="auth-note">验证码 10 分钟内有效。无需设置或记住密码。</p>
            </section>
          </main>
        </MobileScroll>
      </div>
    );
  }

  return (
    <div className="nutrition-app">
      <MobileScroll className="app-screen">
        {tab === "today" && (
          <main className="screen-content today-screen" aria-label="今日饮食">
            <header className="today-header">
              <div>
                <p className="eyebrow">Hi，{data.profile.name}</p>
                <h1>今天也要轻盈呀</h1>
                <button className="stage-link" onClick={() => setReviewOpen(true)}>
                  {planComplete ? <strong>三个月计划已完成</strong> : <>计划第 <strong>{planDay}</strong>/90 天</>} · 阶段第 {stageDay} 天 · {daysUntilReview ? `距复盘 ${daysUntilReview} 天` : missingStageCheckIns ? `还缺 ${missingStageCheckIns} 次状态` : "今天可以复盘"}
                  <ChevronRightIcon />
                </button>
              </div>
              <div className="date-pill">
                <CalendarIcon />
                {new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date())}
              </div>
            </header>

            <input
              ref={cameraRef}
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhoto}
              aria-label="拍摄餐食照片"
            />
            <input
              ref={galleryRef}
              className="visually-hidden"
              type="file"
              accept="image/*"
              onChange={handlePhoto}
              aria-label="从相册选择餐食照片"
            />
            <div className="meal-photo-actions">
              <button className="camera-hero" onClick={() => cameraRef.current?.click()} data-testid="photo-meal-button">
                <span className="camera-icon-wrap"><CameraIcon /></span>
                <span className="camera-copy">
                  <strong>拍照记一餐</strong>
                  <small>拍下这餐，AI 自动估算营养</small>
                </span>
                <PlusIcon className="camera-plus" />
              </button>
              <button className="gallery-upload" onClick={() => galleryRef.current?.click()}>
                <ImageIcon />
                <span><strong>照片识别</strong><small>从手机相册选择</small></span>
                <ChevronRightIcon />
              </button>
              <p className="quota-note">今日 AI 识别 {quota.used}/{quota.limit} 次 · 北京时间零点重置</p>
            </div>

            <section className="surface macro-surface" aria-labelledby="macro-title">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">按已记录餐食与今日训练估算</p>
                  <h2 id="macro-title">营养进度</h2>
                </div>
                <button className="text-button" onClick={() => setTab("profile")}>目标设置</button>
              </div>
              <div className="energy-summary" aria-label="今日摄入与消耗">
                <div>
                  <span>摄入</span>
                  <strong>{round(totals.calories)}<small> kcal</small></strong>
                  <small>来自今日 {todayMeals.length} 餐</small>
                </div>
                <div>
                  <span>消耗</span>
                  <strong>{todayExpenditure}<small> kcal</small></strong>
                  <small>静态 {expenditure.base} + 运动 {todayExercise}</small>
                </div>
              </div>
              <div className="day-mode-row">
                <span>今天按哪种日程估算</span>
                <div className="segmented compact-segmented">
                  {(["training", "rest"] as DayMode[]).map((mode) => (
                    <button key={mode} aria-pressed={todayMode === mode} className={todayMode === mode ? "selected" : ""} onClick={() => setTodayMode(mode)}>
                      {mode === "training" ? "训练日" : "休息日"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="macro-grid">
                <MacroProgress label="碳水" value={totals.carbs} target={targets.carbs} color="#58ad30" />
                <MacroProgress label="蛋白质" value={totals.protein} target={targets.protein} color="#ff8b1f" />
                <MacroProgress label="脂肪" value={totals.fat} target={targets.fat} color="#f4b91f" />
              </div>
              <button className={`coach-strip ${advice.tone}`} onClick={() => setReviewOpen(true)}>
                <CheckCircledIcon />
                <span>
                  <strong>{advice.title}</strong>
                  <small>{advice.detail}</small>
                </span>
                <ChevronRightIcon />
              </button>
            </section>

            <section className="surface recent-surface" aria-labelledby="recent-title">
              <div className="section-heading compact">
                <div>
                  <p className="section-kicker">今日已记录 {todayMeals.length} 餐</p>
                  <h2 id="recent-title">{todayMeals.length ? "最近一餐" : "最近记录"}</h2>
                </div>
                <button className="text-button" onClick={openCheckInForm}>记录体重</button>
              </div>
              {recentMeal ? (
                <div className="meal-row">
                  {photoUrls[recentMeal.id] || recentMeal.isDemo ? (
                    <img
                      src={photoUrls[recentMeal.id] || "/assets/meal-lunch.png"}
                      alt={`${recentMeal.foods}餐食照片`}
                      draggable={false}
                    />
                  ) : (
                    <span className="meal-photo-placeholder" aria-label="餐食照片暂不可用"><CameraIcon /></span>
                  )}
                  <div className="meal-copy">
                    <div className="meal-title-line">
                      <strong>{recentMeal.label} · {recentMeal.date === today ? recentMeal.time : formatShortDate(recentMeal.date)}</strong>
                      {recentMeal.isDemo && <span className="demo-badge">示例</span>}
                    </div>
                    <p>{recentMeal.foods}</p>
                    <span>{recentMeal.calories} kcal · 碳 {recentMeal.carbs} / 蛋 {recentMeal.protein} / 脂 {recentMeal.fat}g</span>
                  </div>
                </div>
              ) : (
                <button className="empty-meal" onClick={() => cameraRef.current?.click()}>
                  <CameraIcon />
                  <span><strong>还没有饮食记录</strong><small>拍下第一餐开始记录</small></span>
                </button>
              )}
            </section>
          </main>
        )}

        {tab === "trends" && (
          <main className="screen-content inner-screen" aria-label="身体趋势">
            <header className="inner-header">
              <p className="eyebrow">身体反馈</p>
              <h1>趋势与复盘</h1>
              <p>数字只是参考，体型和状态一起看。</p>
            </header>
            <section className="summary-band">
              <div><span>当前体重</span><strong>{currentWeight.toFixed(1)}<small> kg</small></strong></div>
              <div><span>阶段变化</span><strong className={stageWeightChange <= 0 ? "positive" : ""}>{stageWeightChange > 0 ? "+" : ""}{stageWeightChange.toFixed(1)}<small> kg</small></strong></div>
              <div><span>最新腰围</span><strong>{(latestCheckIn?.waist || data.profile.waist).toFixed(1)}<small> cm</small></strong></div>
            </section>
            <section className="surface log-surface">
              <div className="section-heading">
                <div><p className="section-kicker">本阶段 {stageCheckIns.length} 次</p><h2>每日状态</h2></div>
                <button className="icon-button" onClick={openCheckInForm} aria-label="新增状态记录"><PlusIcon /></button>
              </div>
              <div className="checkin-list">
                {[...stageCheckIns].slice(-7).reverse().map((item) => (
                  <div className="checkin-row" key={item.date}>
                    <span className="checkin-date">{formatShortDate(item.date)}</span>
                    <div><strong>{item.weight.toFixed(1)} kg</strong><small>腰围 {item.waist.toFixed(1)} cm</small></div>
                    <div className="state-score"><strong>{scoreLabel(round((item.energy + item.training + item.sleep) / 3))}</strong><small>综合状态</small></div>
                  </div>
                ))}
                {!stageCheckIns.length && <p className="empty-state-copy">还没有本阶段状态记录，先从今天的体重和感受开始。</p>}
              </div>
            </section>
            <button className="review-banner" onClick={() => setReviewOpen(true)}>
              <ReloadIcon />
              <span><strong>{daysUntilReview ? `${daysUntilReview} 天后进入阶段复盘` : missingStageCheckIns ? `周期已到，还缺 ${missingStageCheckIns} 次状态记录` : "阶段复盘已准备好"}</strong><small>依据体重腰围、饥饿、碳水渴望、训练和精神状态判断</small></span>
              <ChevronRightIcon />
            </button>
            {data.reviewHistory.length > 0 && (
              <section className="surface history-surface">
                <div className="section-heading compact"><div><p className="section-kicker">已完成 {data.reviewHistory.length} 次</p><h2>最近复盘</h2></div></div>
                {data.reviewHistory.slice(-2).reverse().map((review) => (
                  <div className="history-row" key={review.id}>
                    <span>{formatShortDate(review.date)}</span>
                    <strong>{review.reason}</strong>
                    <small>
                      碳水 {review.carbBefore.toFixed(1)} → {review.carbAfter.toFixed(1)} · 蛋白 {review.proteinBefore.toFixed(1)} → {review.proteinAfter.toFixed(1)}
                      {review.fatBefore !== review.fatAfter && ` · 脂肪 ${review.fatBefore.toFixed(1)} → ${review.fatAfter.toFixed(1)}`} g/kg
                    </small>
                  </div>
                ))}
              </section>
            )}
          </main>
        )}

        {tab === "profile" && (
          <main className="screen-content inner-screen profile-screen" aria-label="个人设置">
            <header className="inner-header">
              <p className="eyebrow">已同步至 {authUser.email}</p>
              <h1>我的计划</h1>
              <p>先从一个温和区间开始，再跟着身体状态调整。</p>
            </header>
            <section className="surface form-surface">
              <h2>基础资料</h2>
              <label className="field-label-custom">称呼<AdaptiveInput value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} /></label>
              <div className="sex-field">
                <span>生理性别</span>
                <div className="sex-choice" role="group" aria-label="生理性别">
                  <button aria-label="男性" title="男性" aria-pressed={profileDraft.sex === "male"} className={profileDraft.sex === "male" ? "selected" : ""} onClick={() => setProfileDraft({ ...profileDraft, sex: "male" })}><GenderMale weight="bold" /></button>
                  <button aria-label="女性" title="女性" aria-pressed={profileDraft.sex === "female"} className={profileDraft.sex === "female" ? "selected" : ""} onClick={() => setProfileDraft({ ...profileDraft, sex: "female" })}><GenderFemale weight="bold" /></button>
                </div>
              </div>
              <div className="field-grid profile-measures">
                <label className="field-label-custom">年龄<AdaptiveInput inputMode="numeric" value={profileDraft.age} onChange={(event) => setProfileDraft({ ...profileDraft, age: event.target.value })} /></label>
                <label className="field-label-custom">身高 cm<AdaptiveInput inputMode="decimal" value={profileDraft.height} onChange={(event) => setProfileDraft({ ...profileDraft, height: event.target.value })} /></label>
                <label className="field-label-custom">体重 kg<AdaptiveInput inputMode="decimal" value={profileDraft.weight} onChange={(event) => setProfileDraft({ ...profileDraft, weight: event.target.value })} /></label>
                <label className="field-label-custom">腰围 cm<AdaptiveInput inputMode="decimal" value={profileDraft.waist} onChange={(event) => setProfileDraft({ ...profileDraft, waist: event.target.value })} /></label>
              </div>
              <label className="field-label-custom">体质倾向</label>
              <div className="choice-row">
                {([
                  ["easy-gain", "偏易胖"],
                  ["balanced", "中性"],
                  ["easy-lean", "偏易瘦"],
                ] as [BodyType, string][]).map(([value, label]) => (
                  <button key={value} aria-pressed={profileDraft.bodyType === value} className={profileDraft.bodyType === value ? "selected" : ""} onClick={() => {
                    const carbMultiplier = value === "easy-gain" ? 2.5 : value === "easy-lean" ? 3.5 : 3;
                    setProfileDraft({ ...profileDraft, bodyType: value, carbMultiplier: String(carbMultiplier) });
                  }}>{label}</button>
                ))}
              </div>
            </section>
            <section className="surface form-surface">
              <div className="section-heading compact"><div><p className="section-kicker">用于估算每日消耗</p><h2>训练与休息</h2></div></div>
              <label className="field-label-custom">训练强度</label>
              <div className="choice-row">
                {([[
                  "light", "轻"
                ], ["moderate", "中"], ["hard", "高"]] as [TrainingIntensity, string][]).map(([value, label]) => (
                  <button key={value} aria-pressed={profileDraft.trainingIntensity === value} className={profileDraft.trainingIntensity === value ? "selected" : ""} onClick={() => setProfileDraft({ ...profileDraft, trainingIntensity: value })}>{label}</button>
                ))}
              </div>
              <div className="training-setting">
                <span><strong>力量训练</strong><small>每个训练日</small></span>
                <div className="duration-options">
                  {[0, 30, 45, 60, 90, 120].map((minutes) => <button key={minutes} aria-pressed={profileDraft.strengthMinutes !== "" && Number(profileDraft.strengthMinutes) === minutes} className={profileDraft.strengthMinutes !== "" && Number(profileDraft.strengthMinutes) === minutes ? "selected" : ""} onClick={() => setProfileDraft({ ...profileDraft, strengthMinutes: String(minutes) })}>{minutes ? `${minutes} 分` : "无"}</button>)}
                </div>
                <label className="field-label-custom duration-custom">自定义力量时长（分钟）<AdaptiveInput inputMode="numeric" placeholder="例如 120" value={profileDraft.strengthMinutes} onChange={(event) => setProfileDraft({ ...profileDraft, strengthMinutes: event.target.value })} /></label>
                <p className="training-hint">填写整次训练时长，含正常组间休息；长时间闲聊、等待等请扣除。休息较多时，可选较低强度。</p>
              </div>
              <div className="training-setting">
                <span><strong>有氧训练</strong><small>建议 30–40 分钟</small></span>
                <div className="duration-options">
                  {[0, 20, 30, 40, 45, 60].map((minutes) => <button key={minutes} aria-pressed={profileDraft.cardioMinutes !== "" && Number(profileDraft.cardioMinutes) === minutes} className={profileDraft.cardioMinutes !== "" && Number(profileDraft.cardioMinutes) === minutes ? "selected" : ""} onClick={() => setProfileDraft({ ...profileDraft, cardioMinutes: String(minutes) })}>{minutes ? `${minutes} 分` : "无"}</button>)}
                </div>
                <label className="field-label-custom duration-custom">自定义有氧时长（分钟）<AdaptiveInput inputMode="numeric" placeholder="例如 35" value={profileDraft.cardioMinutes} onChange={(event) => setProfileDraft({ ...profileDraft, cardioMinutes: event.target.value })} /></label>
              </div>
              <div className="training-setting schedule-setting">
                <span><strong>练休节奏</strong><small>按计划开始日循环</small></span>
                <div className="schedule-controls">
                  {([ ["trainingDays", "练", 6], ["restDays", "休", 3] ] as const).map(([key, label, max]) => (
                    <div className="schedule-stepper" role="group" aria-label={`${label}几天`} key={key}>
                      <span>{label}</span>
                      <button aria-label={`减少${label}的天数`} disabled={profileDraft[key] <= 1} onClick={() => setProfileDraft({ ...profileDraft, [key]: Math.max(1, profileDraft[key] - 1) })}><MinusIcon /></button>
                      <output aria-live="polite">{profileDraft[key]}</output>
                      <button aria-label={`增加${label}的天数`} disabled={profileDraft[key] >= max} onClick={() => setProfileDraft({ ...profileDraft, [key]: Math.min(max, profileDraft[key] + 1) })}><PlusIcon /></button>
                      <span>天</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="estimate-grid">
                <div><span>训练日</span><strong>{draftExpenditure.trainingDay}<small> kcal</small></strong></div>
                <div><span>休息日</span><strong>{draftExpenditure.restDay}<small> kcal</small></strong></div>
                <div><span>周期日均</span><strong>{draftExpenditure.averageDay}<small> kcal</small></strong></div>
              </div>
              <p className="profile-weight-note">静态消耗采用 Mifflin–St Jeor 静息能量 × 1.2；运动用训练时长和强度估算，仅作趋势参考。</p>
            </section>
            <section className="surface form-surface">
              <div className="section-heading compact"><h2>当前营养系数</h2></div>
              <p className="profile-weight-note">目标克数 = 体重 × 系数；按当前填写值折算摄入约 {draftTargetCalories} kcal（碳水/蛋白质每克 4 kcal，脂肪每克 9 kcal）。</p>
              {([
                ["carbMultiplier", "碳水", "2.5–3.5g 起步"],
                ["proteinMultiplier", "蛋白质", "通常 1.2–2.0g"],
                ["fatMultiplier", "脂肪", "维持 0.6–0.8g"],
              ] as ["carbMultiplier" | "proteinMultiplier" | "fatMultiplier", string, string][]).map(([key, label, hint]) => (
                <label className="multiplier-row" key={key}>
                  <span><strong>{label}</strong><small>{hint}</small></span>
                  <AdaptiveInput inputMode="decimal" value={profileDraft[key]} onChange={(event) => setProfileDraft({ ...profileDraft, [key]: event.target.value })} />
                  <b>g/kg</b>
                </label>
              ))}
              <div className="review-length">
                <span><strong>复盘周期</strong><small>建议约 10 天或半个月</small></span>
                <div className="segmented">
                  {[10, 15].map((days) => <button key={days} aria-pressed={profileDraft.reviewDays === days} className={profileDraft.reviewDays === days ? "selected" : ""} onClick={() => setProfileDraft({ ...profileDraft, reviewDays: days as 10 | 15 })}>{days} 天</button>)}
                </div>
              </div>
            </section>
            {profileError && <p className="form-error" role="alert">{profileError}</p>}
            <button className="primary-button" onClick={saveProfile}>{profileSaved ? <><CheckCircledIcon /> 已保存</> : "保存计划"}</button>
            <button className="secondary-button" onClick={resetDemo}><ReloadIcon />恢复示例数据</button>
            <button className="secondary-button logout-button" onClick={logout}>退出当前账号</button>
            <p className="safety-note"><InfoCircledIcon />本工具用于记录和整理个人反馈，不构成医疗或营养处方。有疾病、用药或异常不适时请先咨询专业人士。</p>
          </main>
        )}
      </MobileScroll>

      {storageError && <p className="storage-error" role="alert">{storageError}</p>}

      {keyboard.visible && !mealOpen && !checkInOpen && (
        <button
          className="keyboard-dismiss-button"
          style={{ bottom: keyboard.height + 8 }}
          onClick={keyboard.hide}
          aria-label="收起键盘"
        >
          完成
        </button>
      )}

      <nav className="bottom-nav" aria-label="主要导航">
        {([
          ["today", "今天", HomeIcon],
          ["trends", "趋势", BarChartIcon],
          ["profile", "我的", PersonIcon],
        ] as [Tab, string, typeof HomeIcon][]).map(([value, label, Icon]) => (
          <button key={value} className={tab === value ? "active" : ""} onClick={() => {
            if (keyboard.visible) keyboard.hide();
            setTab(value);
          }}>
            <Icon /><span>{label}</span>
          </button>
        ))}
      </nav>

      <BottomSheet open={mealOpen} onOpenChange={(open) => {
        if (!open) {
          analysisRequestRef.current += 1;
          if (keyboard.visible) keyboard.hide();
        }
        setMealOpen(open);
      }} title="确认这一餐" description="照片只能辅助估算，请核对份量、用油和调味。" snap={0.9}>
        <div className="sheet-form meal-sheet">
          <button className="sheet-cancel" onClick={() => {
            analysisRequestRef.current += 1;
            if (keyboard.visible) keyboard.hide();
            setMealOpen(false);
          }}><Cross2Icon />取消</button>
          {mealDraft.previewUrl && <img className="meal-preview" src={mealDraft.previewUrl} alt="待记录餐食" draggable={false} />}
          <div className={`analysis-status ${analysisMode}`}>
            {analysisMode === "analyzing" && <><ReloadIcon className="spin" />正在尝试 AI 识别…</>}
            {analysisMode === "ai" && <><CheckCircledIcon />AI 已给出初步估算，请确认</>}
            {analysisMode === "manual" && <><InfoCircledIcon />AI 识别暂时失败，请手动填写</>}
          </div>
          <div className="choice-row meal-type-row">
            {["早餐", "午餐", "晚餐", "加餐"].map((label) => <button key={label} aria-pressed={mealDraft.label === label} className={mealDraft.label === label ? "selected" : ""} onClick={() => editMealDraft({ label })}>{label}</button>)}
          </div>
          <label className="field-label-custom">识别到的食物<AdaptiveInput placeholder="例如：米饭、鸡胸肉、西兰花" value={mealDraft.foods} onChange={(event) => editMealDraft({ foods: event.target.value })} /></label>
          <div className="macro-input-grid">
            {([
              ["carbs", "碳水"],
              ["protein", "蛋白质"],
              ["fat", "脂肪"],
            ] as [MacroKey, string][]).map(([key, label]) => (
              <label className="field-label-custom" key={key}>{label} g<AdaptiveInput inputMode="decimal" placeholder="0" value={mealDraft[key]} onChange={(event) => editMealDraft({ [key]: event.target.value })} /></label>
            ))}
          </div>
          {mealError && <p className="form-error" role="alert">{mealError}</p>}
          {keyboard.visible && <button className="sheet-keyboard-dismiss" onClick={keyboard.hide}>完成填写</button>}
          <button className="primary-button" onClick={saveMeal} disabled={!mealDraftValid || mealSaving}>{mealSaving ? "正在保存…" : "保存这餐"}</button>
        </div>
      </BottomSheet>

      <BottomSheet open={checkInOpen} onOpenChange={(open) => { if (!open && keyboard.visible) keyboard.hide(); setCheckInOpen(open); }} title="记录今日状态" description="谭成义的方法强调跟着身体状态走，不只看体重。" snap={0.92}>
        <div className="sheet-form">
          <button className="sheet-cancel" onClick={() => { if (keyboard.visible) keyboard.hide(); setCheckInOpen(false); }}><Cross2Icon />取消</button>
          <div className="field-grid">
            <label className="field-label-custom">体重 kg<AdaptiveInput inputMode="decimal" value={checkInDraft.weight} onChange={(event) => setCheckInDraft({ ...checkInDraft, weight: event.target.value })} /></label>
            <label className="field-label-custom">腰围 cm<AdaptiveInput inputMode="decimal" value={checkInDraft.waist} onChange={(event) => setCheckInDraft({ ...checkInDraft, waist: event.target.value })} /></label>
          </div>
          {([
            ["hunger", "饥饿感", "1 不饿 · 5 很饿"],
            ["craving", "干净碳水渴望", "米饭、馒头、粗粮等"],
            ["energy", "精神状态", "专注、活力和社交意愿"],
            ["training", "训练状态", "欲望、力量和完成度"],
            ["sleep", "睡眠恢复", "时长与醒后感受"],
          ] as [keyof typeof checkInDraft, string, string][]).map(([key, label, hint]) => (
            <div className="score-field" key={key} role="group" aria-label={label}>
              <span><strong>{label}</strong><small>{hint}</small></span>
              <div className="score-buttons">{[1, 2, 3, 4, 5].map((score) => <button key={score} aria-pressed={checkInDraft[key] === score} className={checkInDraft[key] === score ? "selected" : ""} onClick={() => setCheckInDraft({ ...checkInDraft, [key]: score })}>{score}</button>)}</div>
            </div>
          ))}
          {checkInError && <p className="form-error" role="alert">{checkInError}</p>}
          {keyboard.visible && <button className="sheet-keyboard-dismiss" onClick={keyboard.hide}>完成填写</button>}
          <button className="primary-button" onClick={saveCheckIn} disabled={!checkInDraftValid}>保存今日状态</button>
        </div>
      </BottomSheet>

      <BottomSheet open={reviewOpen} onOpenChange={setReviewOpen} title="阶段复盘" description={`当前第 ${stageDay} 天 · 周期 ${data.profile.reviewDays} 天`} snap={0.78}>
        <div className="review-sheet">
          <button className="sheet-cancel" onClick={() => setReviewOpen(false)}><Cross2Icon />取消</button>
          <div className={`review-result ${advice.tone}`}><CheckCircledIcon /><div><strong>{advice.title}</strong><p>{advice.detail}</p></div></div>
          <div className="review-numbers">
            <div><span>当前碳水</span><strong>{data.profile.carbMultiplier.toFixed(1)} <small>g/kg</small></strong></div>
            <ChevronRightIcon />
            <div><span>建议碳水</span><strong>{clamp(data.profile.carbMultiplier + advice.carbDelta, 2, 5).toFixed(1)} <small>g/kg</small></strong></div>
          </div>
          <div className="method-note">
            <strong>判断逻辑</strong>
            <p>强烈饥饿与干净碳水渴望、同时精神和训练状态良好：小幅上调；微微饥饿且状态好：维持；不饿、渴望低：小幅下调；状态差：先排查睡眠、训练和恢复。</p>
          </div>
          {!canReview && <p className="waiting-note"><CalendarIcon />{daysUntilReview ? `距本阶段周期结束还有 ${daysUntilReview} 天。` : "本阶段周期已结束。"}{missingStageCheckIns ? ` 还需 ${missingStageCheckIns} 次有效状态记录。` : ""}</p>}
          <button className="primary-button" disabled={!canReview} onClick={applyReview}>{canReview ? "应用建议并开始新阶段" : "当前阶段继续观察"}</button>
        </div>
      </BottomSheet>
    </div>
  );
}
