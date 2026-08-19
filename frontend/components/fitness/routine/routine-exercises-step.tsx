"use client"

import { ArrowLeft, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert } from "@/components/ui/alert"
import { Spinner } from "@/components/ui/spinner"
import { ExerciseItem, type ExEntry } from "@/components/fitness/routine/exercise-item"
import { cn } from "@/lib/utils"
import type { SetPlanEntry } from "@/lib/routines/routine-mapping"
import { daysOfWeek } from "@/components/fitness/routine/weekdays"

// A per-exercise entry with its ExerciseItem callbacks already bound (to the
// owning day code + index) by the parent — this step never needs to know
// about the by-day/by-index data model, only how to render each item.
export interface WiredExercise {
  key: string
  ex: ExEntry
  onRemove: () => void
  onChange: (patch: Partial<ExEntry>) => void
  onSetMode: (mode: "simple" | "advanced") => void
  onSetsChange: (sets: SetPlanEntry[]) => void
  promptCollapse: boolean
  onConfirmCollapse: () => void
  onCancelCollapse: () => void
}

export interface RoutineExercisesStepProps {
  mode: "create" | "edit"
  submitting?: boolean
  selectedDay: string
  selectedDays: string[]
  onSelectDay: (code: string) => void
  onBack: () => void
  visibleDays: string[]
  exByDay: Record<string, WiredExercise[]>
  onOpenSelector: (code: string) => void
  error: string | null
  onFinish: () => void
}

// Step 2 of the routine wizard: per-day exercise list (series/reps or advanced set plans).
export function RoutineExercisesStep({
  mode,
  submitting,
  selectedDay,
  selectedDays,
  onSelectDay,
  onBack,
  visibleDays,
  exByDay,
  onOpenSelector,
  error,
  onFinish,
}: RoutineExercisesStepProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground hover:bg-accent"
            disabled={submitting}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">Ejercicios</h1>
        </div>
        <Button
          onClick={onFinish}
          disabled={submitting}
          className="font-semibold disabled:bg-muted disabled:text-muted-foreground"
        >
          {submitting ? (
            <>
              <Spinner className="w-4 h-4 mr-2" />
              Guardando...
            </>
          ) : mode === "create" ? (
            "Finalizar"
          ) : (
            "Guardar"
          )}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <p>{error}</p>
        </Alert>
      )}

      <div className="flex gap-2 mb-6 flex-wrap">
        <Button
          variant={selectedDay === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => onSelectDay("all")}
          disabled={submitting}
          className={cn(
            selectedDay !== "all" && "border-border text-muted-foreground hover:bg-accent"
          )}
        >
          Todos
        </Button>
        {selectedDays.map((code) => (
          <Button
            key={code}
            variant={selectedDay === code ? "default" : "outline"}
            size="sm"
            onClick={() => onSelectDay(code)}
            disabled={submitting}
            className={cn(
              selectedDay !== code && "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {daysOfWeek.find((d) => d.code === code)?.name}
          </Button>
        ))}
      </div>

      <div className="space-y-4">
        {visibleDays.map((code) => (
          <div key={code} className="mb-2">
            {selectedDay === "all" && (
              <h3 className="text-muted-foreground text-sm font-medium uppercase mb-3">
                {daysOfWeek.find((d) => d.code === code)?.name}
              </h3>
            )}
            {(exByDay[code] || []).length === 0 ? (
              <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
                <p className="text-muted-foreground text-sm">No hay ejercicios en este día</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(exByDay[code] || []).map((item) => (
                  <ExerciseItem
                    key={item.key}
                    ex={item.ex}
                    onRemove={item.onRemove}
                    onChange={item.onChange}
                    onSetMode={item.onSetMode}
                    onSetsChange={item.onSetsChange}
                    promptCollapse={item.promptCollapse}
                    onConfirmCollapse={item.onConfirmCollapse}
                    onCancelCollapse={item.onCancelCollapse}
                  />
                ))}
              </div>
            )}
            <div
              onClick={() => onOpenSelector(code)}
              className="mt-2 border-2 border-dashed border-border rounded-xl p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
            >
              <Button variant="ghost" className="text-primary hover:text-primary/80 hover:bg-transparent">
                <Plus className="h-4 w-4 mr-2" />
                Agregar ejercicio
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
