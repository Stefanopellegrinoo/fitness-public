"use client"

import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { SetPlanEntry } from "@/lib/routines/routine-mapping"
import { SetPlanEditor } from "@/components/fitness/routine/set-plan-editor"

// Per-exercise draft with its working-set config (series x reps + optional RPE),
// plus the advanced-mode set plan list.
export type ExEntry = {
  exerciseId: string
  name: string
  category?: string
  restSeconds?: number
  notes?: string
  mode: "simple" | "advanced"
  workingSets: number
  repsMin?: number
  repsMax?: number
  rpe?: number
  sets?: SetPlanEntry[]
}

// Categorical taxonomy colors per muscle group — intentionally distinct from
// the primary/brand palette (kept as-is in the Phase 1 redesign).
const muscleGroupColors: Record<string, string> = {
  PECHO: "bg-red-900/30 text-red-400",
  ESPALDA: "bg-blue-900/30 text-blue-400",
  HOMBROS: "bg-orange-900/30 text-orange-400",
  BRAZOS: "bg-purple-900/30 text-purple-400",
  PIERNAS: "bg-green-900/30 text-green-400",
  CORE: "bg-yellow-900/30 text-yellow-400",
  CARDIO: "bg-pink-900/30 text-pink-400",
}

export function ExerciseItem({
  ex,
  onRemove,
  onChange,
  onSetMode,
  onSetsChange,
  promptCollapse,
  onConfirmCollapse,
  onCancelCollapse,
}: {
  ex: ExEntry
  onRemove: () => void
  onChange: (patch: Partial<ExEntry>) => void
  onSetMode: (mode: "simple" | "advanced") => void
  onSetsChange: (sets: SetPlanEntry[]) => void
  promptCollapse: boolean
  onConfirmCollapse: () => void
  onCancelCollapse: () => void
}) {
  const num = (v: string): number | undefined => {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : undefined
  }
  return (
    <div className="p-4 bg-card rounded-xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-foreground font-medium">{ex.name}</h3>
          {ex.category && (
            <span className={cn("inline-block mt-1 text-xs px-2 py-0.5 rounded", muscleGroupColors[ex.category] || "bg-muted text-muted-foreground")}>
              {ex.category}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Eliminar ejercicio" className="text-destructive hover:text-destructive/80 hover:bg-destructive/10">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex gap-1 mt-3">
        {(["simple", "advanced"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onSetMode(m)}
            className={cn(
              "px-3 h-7 rounded-md text-xs font-medium transition-colors",
              ex.mode === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
            )}
          >
            {m === "simple" ? "Simple" : "Avanzado"}
          </button>
        ))}
      </div>

      {ex.mode === "simple" ? (
        <div className="grid grid-cols-4 gap-2 mt-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Series</span>
            <Input type="number" min={1} aria-label="Series" value={ex.workingSets} onChange={(e) => onChange({ workingSets: Math.max(1, num(e.target.value) ?? 1) })} className="bg-muted border-border text-foreground h-9 text-center" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Reps min</span>
            <Input type="number" min={1} aria-label="Reps min" value={ex.repsMin ?? ""} onChange={(e) => onChange({ repsMin: num(e.target.value) })} className="bg-muted border-border text-foreground h-9 text-center" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Reps max</span>
            <Input type="number" min={1} aria-label="Reps max" value={ex.repsMax ?? ""} onChange={(e) => onChange({ repsMax: num(e.target.value) })} className="bg-muted border-border text-foreground h-9 text-center" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">RPE</span>
            <Input type="number" min={1} max={10} aria-label="RPE" value={ex.rpe ?? ""} onChange={(e) => onChange({ rpe: num(e.target.value) })} className="bg-muted border-border text-foreground h-9 text-center" />
          </label>
        </div>
      ) : (
        <>
          {promptCollapse && (
            <div className="flex items-center justify-between gap-2 mt-3 rounded-md border border-amber-600/40 bg-amber-950/20 p-2 text-amber-300 text-sm">
              <span>Perdés la config avanzada de este ejercicio.</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={onConfirmCollapse} className="bg-amber-600 hover:bg-amber-700 text-white">Simplificar</Button>
                <Button size="sm" variant="outline" onClick={onCancelCollapse} className="border-border text-muted-foreground">Cancelar</Button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Descanso ejercicio (s)</span>
              <Input type="number" min={0} aria-label="Descanso ejercicio" value={ex.restSeconds ?? ""} onChange={(e) => onChange({ restSeconds: num(e.target.value) })} className="bg-muted border-border text-foreground h-9 text-center" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Notas</span>
              <Input aria-label="Notas" value={ex.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value || undefined })} className="bg-muted border-border text-foreground h-9" />
            </label>
          </div>
          <SetPlanEditor sets={ex.sets ?? []} onChange={onSetsChange} />
        </>
      )}
    </div>
  )
}
