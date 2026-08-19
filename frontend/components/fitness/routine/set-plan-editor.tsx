"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SetPlanEntry } from "@/lib/routines/routine-mapping"
import { newSetId } from "@/lib/routines/routine-mapping"
import { SET_PRESETS } from "@/lib/routines/set-presets"
import { SetPlanRow } from "./set-plan-row"

export interface SetPlanEditorProps {
  sets: SetPlanEntry[]
  onChange: (next: SetPlanEntry[]) => void
}

export function SetPlanEditor({ sets, onChange }: SetPlanEditorProps) {
  const [pendingPreset, setPendingPreset] = useState<string>("")

  const patchAt = (i: number, patch: Partial<SetPlanEntry>) =>
    onChange(sets.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const removeAt = (i: number) => onChange(sets.filter((_, idx) => idx !== i))
  const duplicateAt = (i: number) => {
    const copy = { ...sets[i], id: newSetId() }
    onChange([...sets.slice(0, i + 1), copy, ...sets.slice(i + 1)])
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= sets.length) return
    const next = sets.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const addSet = () => onChange([...sets, { id: newSetId(), setType: "WORKING", repsMin: 8, repsMax: 12 }])

  const applyPreset = (presetId: string) => {
    const preset = SET_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    onChange(preset.build().map((seed) => ({ ...seed, id: newSetId() })))
    setPendingPreset("")
  }

  const onPresetSelect = (presetId: string) => {
    if (!presetId) return
    if (sets.length > 0) setPendingPreset(presetId)
    else applyPreset(presetId)
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="plantilla">
          Plantilla
        </label>
        <select
          id="plantilla"
          aria-label="Plantilla"
          value=""
          onChange={(e) => onPresetSelect(e.target.value)}
          className="bg-muted border border-border rounded-md text-foreground h-8 px-2 text-sm"
        >
          <option value="">Elegir…</option>
          {SET_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      {pendingPreset && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-600/40 bg-amber-950/20 p-2 text-amber-300 text-sm">
          <span>¿Reemplazar los sets actuales?</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => applyPreset(pendingPreset)} className="bg-amber-600 hover:bg-amber-700 text-white">Reemplazar</Button>
            <Button size="sm" variant="outline" onClick={() => setPendingPreset("")} className="border-border text-muted-foreground">Cancelar</Button>
          </div>
        </div>
      )}

      {sets.map((entry, i) => (
        <SetPlanRow
          key={entry.id}
          entry={entry}
          index={i + 1}
          canMoveUp={i > 0}
          canMoveDown={i < sets.length - 1}
          onChange={(patch) => patchAt(i, patch)}
          onRemove={() => removeAt(i)}
          onDuplicate={() => duplicateAt(i)}
          onMoveUp={() => move(i, -1)}
          onMoveDown={() => move(i, 1)}
        />
      ))}

      <div
        onClick={addSet}
        className="border-2 border-dashed border-border rounded-xl p-3 text-center cursor-pointer hover:border-primary/50 transition-colors"
      >
        <Button variant="ghost" className="text-primary hover:text-primary/80 hover:bg-transparent">
          <Plus className="h-4 w-4 mr-2" />
          Agregar set
        </Button>
      </div>
    </div>
  )
}
