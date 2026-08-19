"use client"

import { useState } from "react"
import { Minus, Plus, Trash2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SessionSet } from "@/lib/workouts/session-exercises"
import { PlannedSetBadge } from "./planned-set-badge"

export interface ActiveSetRowProps {
  set: SessionSet
  index: number
  suggestedWeight?: number
  ghost?: { weightKg: number; reps: number }
  onUpdate: (field: "weight" | "reps", delta: number) => void
  onSetWeight: (value: number) => void
  onToggle: () => void
  onRemove: () => void
}

export function ActiveSetRow({ set, index, suggestedWeight, ghost, onUpdate, onSetWeight, onToggle, onRemove }: ActiveSetRowProps) {
  const showSuggested = !set.completed && set.weight === 0 && suggestedWeight != null
  const effectiveWeight = set.weight || suggestedWeight || 0
  const showGhost = !set.completed && ghost

  // Draft while the input has focus; committed on blur/Enter instead of per
  // keystroke because a completed set PATCHes the server on every change.
  const [weightDraft, setWeightDraft] = useState<string | null>(null)

  const commitWeight = () => {
    if (weightDraft === null) return
    setWeightDraft(null)
    const parsed = Number(weightDraft)
    // An unchanged commit is skipped so tapping in and out of the field
    // doesn't turn a suggestion into a logged weight.
    if (weightDraft.trim() === "" || !Number.isFinite(parsed) || parsed < 0 || parsed === effectiveWeight) return
    onSetWeight(parsed)
  }

  return (
    <div className={cn("rounded-2xl border transition-all", set.completed ? "bg-success/10 border-success/20" : "bg-muted border-border")}>
      {set.plan && (
        <div className="px-4 pt-3">
          <PlannedSetBadge plan={set.plan} />
        </div>
      )}
      <div className="flex items-center gap-2 p-3">
        <span className={cn("w-8 text-xs font-bold", set.completed ? "text-success" : "text-muted-foreground")}>
          {set.completed ? "✓" : index}
        </span>

        <div className="flex items-center justify-center gap-2 flex-1 min-w-0">
          <button aria-label="Bajar peso" onClick={() => onUpdate("weight", -2.5)} className="text-muted-foreground hover:text-foreground"><Minus className="h-4 w-4" /></button>
          <div className="text-center min-w-[52px] flex flex-col items-center">
            <input
              aria-label="Peso del set"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={weightDraft ?? String(effectiveWeight)}
              onFocus={(e) => { setWeightDraft(String(effectiveWeight)); e.target.select() }}
              onChange={(e) => setWeightDraft(e.target.value)}
              onBlur={commitWeight}
              onKeyDown={(e) => { if (e.key === "Enter") { commitWeight(); e.currentTarget.blur() } }}
              className="w-[52px] bg-transparent text-center text-foreground font-bold text-xl outline-none focus:ring-1 focus:ring-primary rounded-md [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            {showSuggested && <span className="text-[8px] text-primary font-bold uppercase">sugerido</span>}
            {showGhost && <span className="text-[8px] text-muted-foreground font-bold">Ant: {ghost.weightKg}kg</span>}
          </div>
          <button aria-label="Subir peso" onClick={() => onUpdate("weight", 2.5)} className="text-muted-foreground hover:text-foreground"><Plus className="h-4 w-4" /></button>
        </div>

        <div className="flex items-center justify-center gap-2 w-20">
          <button aria-label="Bajar reps" onClick={() => onUpdate("reps", -1)} className="text-muted-foreground hover:text-foreground"><Minus className="h-4 w-4" /></button>
          <div className="text-center min-w-[30px] flex flex-col items-center">
            <span aria-label="Reps del set" className="text-foreground font-bold text-xl">{set.reps}</span>
            {showGhost && <span className="text-[8px] text-muted-foreground font-bold">Ant: {ghost.reps}</span>}
          </div>
          <button aria-label="Subir reps" onClick={() => onUpdate("reps", 1)} className="text-muted-foreground hover:text-foreground"><Plus className="h-4 w-4" /></button>
        </div>

        <div className="flex gap-2 w-20 justify-end">
          <Button aria-label="Borrar serie" variant="ghost" size="icon" onClick={onRemove} className="h-9 w-9 text-destructive/50"><Trash2 className="h-4 w-4" /></Button>
          <Button
            aria-label="Completar set"
            variant={set.completed ? "default" : "outline"}
            size="icon"
            onClick={onToggle}
            className={cn("h-9 w-9 rounded-xl", set.completed ? "bg-success border-0" : "border-border text-muted-foreground")}
          >
            <Check className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
