"use client"

import { useState } from "react"
import { ExerciseSelector } from "@/components/fitness/exercise-selector"
import { type ExEntry } from "@/components/fitness/routine/exercise-item"
import { RoutineInfoStep } from "@/components/fitness/routine/routine-info-step"
import { RoutineExercisesStep, type WiredExercise } from "@/components/fitness/routine/routine-exercises-step"
import { daysOfWeek, CODE_ORDER, WEEKDAY_TO_CODE, byWeekdayOrder } from "@/components/fitness/routine/weekdays"
import type { CreateRoutinePayload, Exercise } from "@/lib/types/api.types"
import { RoutineDraft, SetPlanDraft, SetPlanEntry, SetPlanSeed, isSetListAdvanced, newSetId, spreadDefined, toPayload } from "@/lib/routines/routine-mapping"

// Inverse of isSetListAdvanced (routine-mapping.ts): true when the set list
// is simple enough to collapse losslessly into the simple-mode summary.
function isHomogeneousWorking(sets: SetPlanEntry[] = []): boolean {
  return !isSetListAdvanced(sets)
}

// --- Set-plan value range validation (handleFinish, on the built draft) ---
// Mirrors the design doc's ranges, which are otherwise only expressed as HTML
// min/max hints on the inputs (non-blocking for manual/pasted entry).
type RangeSpec = { min: number; max?: number; label: string }

// "when present" = value is not null/undefined; 0 is only flagged when the
// range's min excludes it (e.g. reps=0 is invalid, rest=0 is valid).
function rangeViolation(value: number | null | undefined, { min, max, label }: RangeSpec): string | null {
  if (value == null) return null
  if (value < min || (max != null && value > max)) {
    return max != null ? `${label} debe estar entre ${min} y ${max}` : `${label} debe ser mayor o igual a ${min}`
  }
  return null
}

function firstRangeViolation<T extends Record<string, unknown>>(values: T, ranges: Array<[keyof T, RangeSpec]>): string | null {
  for (const [field, spec] of ranges) {
    const violation = rangeViolation(values[field] as number | null | undefined, spec)
    if (violation) return violation
  }
  return null
}

const SET_PLAN_RANGES: Array<[keyof SetPlanSeed, RangeSpec]> = [
  ["repsMin", { min: 1, label: "Reps mínimas" }],
  ["repsMax", { min: 1, label: "Reps máximas" }],
  ["targetRpe", { min: 1, max: 10, label: "RPE" }],
  ["targetRir", { min: 0, label: "RIR" }],
  ["percentOfTopSet", { min: 1, max: 200, label: "% del top set" }],
  ["targetWeightKg", { min: 0, label: "Peso objetivo" }],
  ["restSeconds", { min: 0, label: "Descanso" }],
]

const SIMPLE_SET_RANGES: Array<[keyof SetPlanDraft, RangeSpec]> = [
  ["repsMin", { min: 1, label: "Reps mínimas" }],
  ["repsMax", { min: 1, label: "Reps máximas" }],
  ["rpe", { min: 1, max: 10, label: "RPE" }],
]

export interface RoutineFormProps {
  mode: "create" | "edit"
  initial?: RoutineDraft
  submitting?: boolean
  onSubmit: (payload: CreateRoutinePayload) => Promise<void>
}

// Nested draft (edit) -> weekday-based wizard state. Days are keyed by their
// weekday; a day without a weekday anchor takes the next free weekday code.
function deriveState(initial?: RoutineDraft): {
  name: string
  selectedDays: string[]
  exByDay: Record<string, ExEntry[]>
} {
  if (!initial || initial.days.length === 0) {
    // No day pre-selected. Seeding Monday here made the chip the user taps to
    // CHOOSE Monday the one that turns it off, emptying the selection and
    // disabling "Siguiente" with nothing on screen to explain it — step 1 shows
    // no error, so the greyed-out button was the whole message. It also added a
    // day nobody asked for to every routine built by picking other days.
    return { name: initial?.name ?? "", selectedDays: [], exByDay: {} }
  }
  const exByDay: Record<string, ExEntry[]> = {}
  const used = new Set<string>()
  const selected: string[] = []
  for (const day of initial.days) {
    let code = day.weekday ? WEEKDAY_TO_CODE[day.weekday] : undefined
    if (!code || used.has(code)) code = CODE_ORDER.find((c) => !used.has(c)) ?? code ?? "L"
    used.add(code)
    selected.push(code)
    exByDay[code] = day.exercises.map((ex) => ({
      exerciseId: ex.exerciseId,
      name: ex.name,
      restSeconds: ex.restSeconds,
      notes: ex.notes,
      mode: ex.advanced ? "advanced" : "simple",
      workingSets: ex.sets.workingSets,
      repsMin: ex.sets.repsMin,
      repsMax: ex.sets.repsMax,
      rpe: ex.sets.rpe,
      sets: (ex.setPlans ?? []).map((s) => ({ ...s, id: newSetId() })),
    }))
  }
  selected.sort(byWeekdayOrder)
  return { name: initial.name, selectedDays: selected, exByDay }
}

export function RoutineForm({ mode, initial, submitting, onSubmit }: RoutineFormProps) {
  // Compute once on mount — deriveState mints throwaway newSetId() ids per
  // call, so re-running it on every render would waste ids for nothing (the
  // result is only ever consumed by the initializers below).
  const [seed] = useState(() => deriveState(initial))
  const [step, setStep] = useState<"info" | "exercises">("info")
  const [name, setName] = useState(seed.name)
  const [selectedDays, setSelectedDays] = useState<string[]>(seed.selectedDays)
  const [selectedDay, setSelectedDay] = useState<string>(seed.selectedDays[0] ?? "L")
  const [exByDay, setExByDay] = useState<Record<string, ExEntry[]>>(seed.exByDay)
  const [showSelector, setShowSelector] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // `${code}-${idx}` of the exercise awaiting confirmation to collapse advanced -> simple
  const [collapsePrompt, setCollapsePrompt] = useState<string | null>(null)

  const toggleDay = (code: string) => {
    setSelectedDays((prev) => {
      const next = prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]
      return next.slice().sort(byWeekdayOrder)
    })
  }

  const addExercise = (ex: Exercise) => {
    if (selectedDay === "all") return
    setExByDay((prev) => ({
      ...prev,
      [selectedDay]: [
        ...(prev[selectedDay] || []),
        { exerciseId: ex.id, name: ex.name, category: ex.category, mode: "simple", workingSets: 3, repsMin: 8, repsMax: 12 },
      ],
    }))
  }

  const removeExercise = (code: string, idx: number) => {
    setExByDay((prev) => ({
      ...prev,
      [code]: (prev[code] || []).filter((_, i) => i !== idx),
    }))
    // Removing an exercise shifts indices, invalidating the single index-keyed
    // collapsePrompt slot (`${code}-${idx}`) regardless of which day/index it
    // pointed at — always clear it rather than trying to remap the key.
    setCollapsePrompt(null)
  }

  const updateExercise = (code: string, idx: number, patch: Partial<ExEntry>) => {
    setExByDay((prev) => ({
      ...prev,
      [code]: (prev[code] || []).map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    }))
  }

  // Simple -> advanced: seed the set-plan list from the current simple summary
  // (or keep the existing list if one is already present). Advanced -> simple
  // (Task 9) is intentionally not handled here.
  const seedAdvanced = (e: ExEntry): SetPlanEntry[] =>
    e.sets && e.sets.length > 0
      ? e.sets
      : Array.from({ length: Math.max(1, e.workingSets) }, () => ({
          id: newSetId(),
          setType: "WORKING" as const,
          ...spreadDefined({ repsMin: e.repsMin, repsMax: e.repsMax, targetRpe: e.rpe }, ["repsMin", "repsMax", "targetRpe"] as const),
        }))

  // Advanced -> simple; caller must confirm via collapsePrompt first when non-homogeneous.
  const collapseToSimple = (code: string, idx: number) => {
    const e = exByDay[code][idx]
    const first = (e.sets ?? []).find((s) => s.setType !== "WARMUP")
    updateExercise(code, idx, {
      mode: "simple",
      workingSets: Math.max(1, (e.sets ?? []).filter((s) => s.setType !== "WARMUP").length || 1),
      repsMin: first?.repsMin,
      repsMax: first?.repsMax,
      rpe: first?.targetRpe,
    })
    setCollapsePrompt(null)
  }

  const setMode = (code: string, idx: number, mode: "simple" | "advanced") => {
    if (mode === "advanced") {
      updateExercise(code, idx, { mode, sets: seedAdvanced(exByDay[code][idx]) })
      return
    }
    const e = exByDay[code][idx]
    if (isHomogeneousWorking(e.sets)) collapseToSimple(code, idx)
    else setCollapsePrompt(`${code}-${idx}`)
  }

  const setAdvancedSets = (code: string, idx: number, sets: SetPlanEntry[]) =>
    updateExercise(code, idx, { sets })

  const buildDraft = (): RoutineDraft => ({
    name: name.trim(),
    // Skip selected days that ended up with no exercises (the nested contract
    // requires >= 1 exercise per day); order days by the weekday sequence.
    days: selectedDays
      .filter((code) => (exByDay[code] || []).length > 0)
      .slice()
      .sort(byWeekdayOrder)
      .map((code, di) => {
        const d = daysOfWeek.find((x) => x.code === code)!
        return {
          name: d.name,
          weekday: d.weekday,
          order: di + 1,
          exercises: (exByDay[code] || []).map((e, ei) => ({
            exerciseId: e.exerciseId,
            name: e.name,
            order: ei,
            restSeconds: e.restSeconds,
            notes: e.notes,
            advanced: e.mode === "advanced",
            sets: { workingSets: e.workingSets, repsMin: e.repsMin, repsMax: e.repsMax, rpe: e.rpe },
            setPlans:
              e.mode === "advanced"
                ? (e.sets ?? []).map(({ id, ...seed }): SetPlanSeed => seed)
                : undefined,
          })),
        }
      }),
  })

  const handleFinish = async () => {
    setError(null)
    if (name.trim().length < 3) return setError("El nombre debe tener al menos 3 caracteres")
    if (selectedDays.length === 0) return setError("Seleccioná al menos un día")
    const draft = buildDraft()
    if (draft.days.length === 0) return setError("Agregá al menos un ejercicio")
    for (const day of draft.days) {
      for (const ex of day.exercises) {
        if (ex.sets.workingSets < 1) return setError("Cada ejercicio necesita al menos 1 serie")
        if (ex.advanced && (ex.setPlans?.length ?? 0) < 1) return setError(`El ejercicio "${ex.name}" necesita al menos 1 set`)
        if (ex.advanced) {
          for (const plan of ex.setPlans ?? []) {
            const violation = firstRangeViolation(plan, SET_PLAN_RANGES)
            if (violation) return setError(`El ejercicio "${ex.name}": ${violation}`)
          }
        } else {
          const violation = firstRangeViolation(ex.sets, SIMPLE_SET_RANGES)
          if (violation) return setError(`El ejercicio "${ex.name}": ${violation}`)
        }
      }
    }
    try {
      await onSubmit(toPayload(draft))
    } catch (e) {
      console.error("Error saving routine:", e)
      setError("No pudimos guardar la rutina. Revisá los datos e intentá de nuevo.")
    }
  }

  // ---- Step 1: name + day selection ----
  if (step === "info") {
    return (
      <div className="lg:max-w-2xl lg:mx-auto">
        <RoutineInfoStep
          mode={mode}
          name={name}
          onNameChange={setName}
          selectedDays={selectedDays}
          onToggleDay={toggleDay}
          error={error}
          onNext={() => {
            setError(null)
            if (!selectedDays.includes(selectedDay)) setSelectedDay(selectedDays[0] ?? "L")
            setStep("exercises")
          }}
        />
      </div>
    )
  }

  // ---- Step 2: exercises per day (with series/reps) ----
  // Wire each exercise's ExerciseItem callbacks to its (code, idx) slot here,
  // so the presentational step never needs to know about the by-day/by-index model.
  const visibleDays = selectedDay === "all" ? selectedDays : [selectedDay]
  const wiredExByDay: Record<string, WiredExercise[]> = Object.fromEntries(
    Object.entries(exByDay).map(([code, list]) => [
      code,
      list.map((ex, idx) => ({
        key: `${code}-${idx}-${ex.exerciseId}`,
        ex,
        onRemove: () => removeExercise(code, idx),
        onChange: (patch: Partial<ExEntry>) => updateExercise(code, idx, patch),
        onSetMode: (mode: "simple" | "advanced") => setMode(code, idx, mode),
        onSetsChange: (sets: SetPlanEntry[]) => setAdvancedSets(code, idx, sets),
        promptCollapse: collapsePrompt === `${code}-${idx}`,
        onConfirmCollapse: () => collapseToSimple(code, idx),
        onCancelCollapse: () => setCollapsePrompt(null),
      })),
    ])
  )

  return (
    <div className="lg:max-w-2xl lg:mx-auto">
      <RoutineExercisesStep
        mode={mode}
        submitting={submitting}
        selectedDay={selectedDay}
        selectedDays={selectedDays}
        onSelectDay={setSelectedDay}
        onBack={() => setStep("info")}
        visibleDays={visibleDays}
        exByDay={wiredExByDay}
        onOpenSelector={(code) => {
          setSelectedDay(code)
          setShowSelector(true)
        }}
        error={error}
        onFinish={handleFinish}
      />
      <ExerciseSelector open={showSelector} onClose={() => setShowSelector(false)} onSelect={addExercise} />
    </div>
  )
}
