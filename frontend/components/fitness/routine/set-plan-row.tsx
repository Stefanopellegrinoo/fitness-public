"use client"

import { useState } from "react"
import { Copy, Trash2, ChevronUp, ChevronDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SetPlanEntry } from "@/lib/routines/routine-mapping"
import { SET_TYPE_OPTIONS } from "@/lib/routines/set-types"

const num = (v: string): number | undefined => {
  const n = Number(v)
  return v.trim() !== "" && Number.isFinite(n) ? n : undefined
}

// The subset of SetPlanEntry keys that are numeric fields editable via numberField.
// Excludes `id` (string) and `setType` (SetType) so the compiler can check the
// patch shape without an `as` cast masking the hole.
type NumericSetField =
  | "repsMin"
  | "repsMax"
  | "targetRpe"
  | "targetRir"
  | "percentOfTopSet"
  | "targetWeightKg"
  | "restSeconds"

export interface SetPlanRowProps {
  entry: SetPlanEntry
  index: number
  canMoveUp: boolean
  canMoveDown: boolean
  onChange: (patch: Partial<SetPlanEntry>) => void
  onRemove: () => void
  onDuplicate: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

const numberField =
  (entry: SetPlanEntry, onChange: (p: Partial<SetPlanEntry>) => void) =>
  (label: string, key: NumericSetField, extra?: { min?: number; max?: number }) => (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <Input
        aria-label={label}
        type="number"
        min={extra?.min}
        max={extra?.max}
        value={entry[key] ?? ""}
        onChange={(e) => onChange({ [key]: num(e.target.value) })}
        className="bg-muted border-border text-foreground h-9 text-center"
      />
    </label>
  )

export function SetPlanRow({ entry, index, canMoveUp, canMoveDown, onChange, onRemove, onDuplicate, onMoveUp, onMoveDown }: SetPlanRowProps) {
  const [showMore, setShowMore] = useState(false)
  const field = numberField(entry, onChange)
  return (
    <div className="p-3 bg-muted rounded-lg border border-border">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-6">#{index}</span>
        <select
          aria-label="Tipo de set"
          value={entry.setType}
          onChange={(e) => onChange({ setType: e.target.value as SetPlanEntry["setType"] })}
          className="flex-1 min-w-0 bg-card border border-border rounded-md text-foreground h-9 px-2 text-sm"
        >
          {SET_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Button variant="ghost" size="icon" onClick={onMoveUp} disabled={!canMoveUp} aria-label="Subir" className="text-muted-foreground hover:text-foreground h-8 w-8">
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onMoveDown} disabled={!canMoveDown} aria-label="Bajar" className="text-muted-foreground hover:text-foreground h-8 w-8">
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicar" className="text-muted-foreground hover:text-foreground h-8 w-8">
          <Copy className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Borrar" className="text-destructive hover:text-destructive/80 h-8 w-8">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-2">
        {field("Reps min", "repsMin", { min: 1 })}
        {field("Reps max", "repsMax", { min: 1 })}
        {field("RPE", "targetRpe", { min: 1, max: 10 })}
      </div>

      <button type="button" onClick={() => setShowMore((v) => !v)} className={cn("mt-2 text-xs text-primary hover:text-primary/80")}>
        {showMore ? "menos" : "más"}
      </button>

      {showMore && (
        <div className="grid grid-cols-4 gap-2 mt-2">
          {field("RIR", "targetRir", { min: 0 })}
          {field("%top", "percentOfTopSet", { min: 1, max: 200 })}
          {field("Peso", "targetWeightKg", { min: 0 })}
          {field("Descanso", "restSeconds", { min: 0 })}
        </div>
      )}
    </div>
  )
}
