/**
 * API Type Definitions
 * TypeScript interfaces matching backend DTOs
 *
 * UPDATED (2026-04-08):
 * - BodyMetric: Corregido para coincidir con el schema de body-metrics.routes.ts
 * - WorkoutSession: Corregido para coincidir con workouts.routes.ts (sets, no exercises[])
 * - WorkoutSet: Agregado para el schema real del backend
 * - NutritionEntry: Agregado para nutrition.routes.ts
 * - DashboardSummary: Corregido para coincidir con dashboard.routes.ts
 * - Exercise: Agregado campo category (PECHO, ESPALDA, etc.)
 */

/**
 * Authenticated user object
 */
export interface User {
  id: string;
  email: string;
  createdAt?: string;
}

/**
 * Authentication response from backend
 * Tokens come via HttpOnly Set-Cookie headers
 */
export interface AuthResponse {
  user: User;
}

/**
 * Dashboard summary — matches GET /api/dashboard response
 * { data: { todayCalories, weeklyWorkouts, activeMinutes, currentWeightKg, nextWorkout } }
 */
export interface DashboardSummary {
  todayCalories: number;
  weeklyWorkouts: number;
  activeMinutes: number;
  currentWeightKg: number | null;
  nextWorkout: {
    id: string;
    name: string;
    exercisesCount: number;
  } | null;
}

/**
 * Exercise definition with muscle group / category
 * category values: PECHO, ESPALDA, HOMBROS, BRAZOS, PIERNAS, CORE, CARDIO, OTRO
 */
export interface Exercise {
  id: string;
  name: string;
  category: string;
  description?: string;
  muscleGroup?: string; // alias legacy
  difficulty?: string;
}

export type SetType =
  | 'WARMUP' | 'WORKING' | 'TOP' | 'BACKOFF' | 'DROP' | 'MYOREP' | 'RESTPAUSE' | 'AMRAP';

export type Weekday =
  | 'LUNES' | 'MARTES' | 'MIERCOLES' | 'JUEVES' | 'VIERNES' | 'SABADO' | 'DOMINGO';

export interface RoutineSetPlan {
  id?: string;
  order: number;
  setType: SetType;
  repsMin?: number | null;
  repsMax?: number | null;
  targetRpe?: number | null;
  targetRir?: number | null;
  percentOfTopSet?: number | null;
  targetWeightKg?: number | null;
  restSeconds?: number | null;
}

export interface RoutineDayExercise {
  id?: string;
  exerciseId: string;
  exercise?: Exercise;
  order: number;
  restSeconds?: number | null;
  notes?: string | null;
  setPlans: RoutineSetPlan[];
}

export interface RoutineDay {
  id: string;
  name: string;
  order: number;
  weekday?: Weekday | null;
  exercises: RoutineDayExercise[];
}

/**
 * A routine day WITHOUT its exercises — what `GET /routines/:id/next-day`
 * actually answers.
 *
 * That route's `findMany` carries no `include`, so `exercises` never travels.
 * Typing its result as a full `RoutineDay` claimed a field that is `undefined`
 * at runtime, and the only reason nothing broke is that the caller reads `id`
 * and `name` alone — the neighbouring day LIST does `day.exercises.length`, and
 * copying that one line onto the suggestion would have thrown in production.
 *
 * Narrowed rather than fixed on the server on purpose: nothing needs the
 * suggestion's exercises, so shipping them would be payload no one reads.
 */
export type RoutineDaySummary = Pick<RoutineDay, 'id' | 'name' | 'order' | 'weekday'>;

/** One entry of a session exercise's planSnapshot (mirrors RoutineSetPlan, no id). */
export interface PlannedSet {
  order: number;
  setType: SetType;
  repsMin?: number | null;
  repsMax?: number | null;
  targetRpe?: number | null;
  targetRir?: number | null;
  percentOfTopSet?: number | null;
  targetWeightKg?: number | null;
  restSeconds?: number | null;
}

/** A WorkoutSessionExercise row as returned in session.exercises[]. */
export interface WorkoutSessionExercise {
  exerciseId: string;
  exercise?: Exercise;
  planSnapshot: PlannedSet[];
  targetSets?: number | null;
  targetReps?: string | null;
  targetRpe?: number | null;
}

// Legacy flat exercise row — still returned by the GET dual-write.
export interface RoutineExercise {
  id?: string;
  routineId?: string;
  exerciseId: string;
  exercise?: Exercise;
  order: number;
  targetSets: number;
  targetReps: string;
  targetRpe?: number;
  dayOfWeek?: Weekday;
}

export interface Routine {
  id: string;
  name: string;
  days: RoutineDay[];
  exercises: RoutineExercise[]; // legacy dual-write; read-only back-compat
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoutinePayload {
  name: string;
  days: Array<{
    name: string;
    order: number;
    weekday?: Weekday;
    exercises: Array<{
      exerciseId: string;
      order: number;
      restSeconds?: number;
      notes?: string;
      setPlans: Array<{
        order: number;
        setType?: SetType;
        repsMin?: number;
        repsMax?: number;
        targetRpe?: number;
        targetRir?: number;
        percentOfTopSet?: number;
        targetWeightKg?: number;
        restSeconds?: number;
      }>;
    }>;
  }>;
}

/**
 * Workout set — matches WorkoutSetSchema in workouts.routes.ts
 */
export interface WorkoutSet {
  id: string;
  exerciseId: string;
  exercise?: Exercise;
  setNumber: number;
  weightKg: number;
  reps: number;
  rpe?: number; // Rate of Perceived Exertion (1-10)
  isWarmup: boolean;
  setType?: SetType;
}

/**
 * Workout session — matches the backend WorkoutSession with sets
 * POST /api/workouts expects: { notes?, routineId?, sets: WorkoutSet[] }
 * GET  /api/workouts/sessions returns: WorkoutSession[]
 */
export interface WorkoutSession {
  id: string;
  userId: string;
  routineId?: string;
  routine?: Routine;
  notes?: string;
  startedAt: string; // ISO8601
  finishedAt?: string; // ISO8601
  sets: WorkoutSet[];
  exercises?: WorkoutSessionExercise[];
}

/**
 * Create workout payload — what the frontend sends to POST /api/workouts
 */
export interface CreateWorkoutPayload {
  notes?: string;
  routineId?: string;
  sets: {
    exerciseId: string;
    setNumber: number;
    weightKg: number;
    reps: number;
    rpe?: number;
    isWarmup?: boolean;
    setType?: SetType;
  }[];
}

/**
 * Body metric record — matches body-metrics.routes.ts / Prisma BodyMetrics model
 * FIX: Antes era 'Metric' con weight/bodyFat/muscle/water → renombrado y corregido
 */
export interface BodyMetric {
  id: string;
  userId: string;
  weightKg?: number;
  muscleMassKg?: number;
  fatMassKg?: number;
  chestCm?: number;
  waistCm?: number;
  hipCm?: number;
  leftArmCm?: number;
  rightArmCm?: number;
  leftThighCm?: number;
  rightThighCm?: number;
  leftCalfCm?: number;
  rightCalfCm?: number;
  notes?: string;
  createdAt: string; // ISO8601
}

/**
 * Nutrition entry — matches NutritionEntry model in nutrition.routes.ts
 */
export interface NutritionEntry {
  id: string;
  userId: string;
  foodItemId?: string;
  foodItem?: FoodItem;
  foodName: string;
  grams: number;
  mealCategory: 'Desayuno' | 'Almuerzo' | 'Merienda' | 'Cena' | 'Snacks';
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  date: string; // ISO8601
  status: string;
}

/**
 * Create nutrition entry payload
 *
 * The four macros are optional on the wire (nutrition.routes.ts): the backend
 * derives them from the FoodItem when `foodItemId` is present and they are
 * omitted. They were missing from this interface even though the sheet has
 * always sent them — spread properties skip the excess-property check, so it
 * compiled. A recipe entry has NO `foodItemId`, so there is nothing for the
 * backend to derive from: sending them is mandatory or the entry lands at 0 kcal.
 */
export interface CreateNutritionEntryPayload {
  foodItemId?: string;
  foodName: string;
  grams: number;
  mealCategory: 'Desayuno' | 'Almuerzo' | 'Merienda' | 'Cena' | 'Snacks';
  date?: string; // ISO8601, defaults to today
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  // The instants bounding the user's local day, sent so the backend merges
  // within the same day the diary reads back. Both or neither — half a window
  // is a 400. See dayBounds() in nutrition.service.ts.
  mergeFrom?: string;
  mergeTo?: string;
}

/**
 * Recipe macros — always DERIVED server-side from the referenced FoodItems,
 * never persisted. Mirrors computeRecipeMacros() in recipeMacros.ts.
 */
export interface MacroSet {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface RecipeNutrition {
  totalGrams: number;
  gramsPerServing: number;
  total: MacroSet;
  /** null when totalGrams is 0 — there is no meaningful "per 100g" of nothing. */
  per100g: MacroSet | null;
  perServing: MacroSet;
  /** true when any ingredient is missing any of its four per-100g values. */
  hasIncompleteMacros: boolean;
}

/**
 * A row of GET /api/recipes — the light shape, without the ingredients array
 * but with every derived value the picker needs.
 */
export interface RecipeListItem {
  id: string;
  name: string;
  servings: number;
  ingredientCount: number;
  nutrition: RecipeNutrition;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeIngredient {
  id: string;
  foodItemId: string;
  grams: number;
  foodItem: {
    id: string;
    name: string;
    brand: string | null;
    caloriesPer100g: number | null;
    proteinPer100g: number | null;
    carbsPer100g: number | null;
    fatPer100g: number | null;
  };
}

/** The full shape of GET /api/recipes/:id, POST and PATCH. */
export interface Recipe {
  id: string;
  name: string;
  servings: number;
  createdAt: string;
  updatedAt: string;
  ingredients: RecipeIngredient[];
  nutrition: RecipeNutrition;
}

export interface RecipeIngredientInput {
  foodItemId: string;
  grams: number;
}

export interface CreateRecipePayload {
  name: string;
  servings: number;
  ingredients: RecipeIngredientInput[];
}

/**
 * Every field optional, and only the ones present are sent. Sending `servings`
 * on a name-only edit would reset a recipe that yields 8 back to 1 — the same
 * trap the backend's UpdateRecipeSchema is written field by field to avoid.
 *
 * When `ingredients` is present the backend replaces them wholesale.
 */
export type UpdateRecipePayload = Partial<CreateRecipePayload>;

/**
 * Food item from the database
 */
/**
 * Food item from the database.
 *
 * The four macros are nullable, not merely optional: they are `Float?` in the
 * schema and the routes hand the Prisma row straight back, so a food imported
 * from OpenFoodFacts without a full nutrition table arrives with real `null`s.
 * Declaring them `number | undefined` typed away a value the API actually sends
 * — and it is precisely the value the "Datos incompletos" flag exists to detect.
 */
export interface FoodItem {
  id: string;
  name: string;
  brand?: string;
  barcode?: string;
  source?: string;
  caloriesPer100g?: number | null;
  proteinPer100g?: number | null;
  carbsPer100g?: number | null;
  fatPer100g?: number | null;
  isGramBased: boolean;
  servingName?: string;
}

/**
 * Nutrition goal
 */
export interface NutritionGoal {
  id: string;
  userId: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  isCalculated: boolean;
  updatedAt: string;
}

/**
 * API request/response pagination metadata
 */
export interface PaginationMeta {
  offset: number;
  limit: number;
  total: number;
}

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T> {
  data: T;
  pagination?: PaginationMeta;
}
