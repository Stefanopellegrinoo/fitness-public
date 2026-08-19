import type { PlannedSet } from "@/lib/types/api.types"
import { SET_TYPE_OPTIONS } from "@/lib/routines/set-types"

const labelFor = (t: PlannedSet["setType"]) => SET_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t

const repRange = (p: PlannedSet): string | null => {
  if (p.repsMin != null && p.repsMax != null) return p.repsMin === p.repsMax ? `${p.repsMin}` : `${p.repsMin}–${p.repsMax}`
  if (p.repsMin != null) return `${p.repsMin}`
  if (p.repsMax != null) return `${p.repsMax}`
  return null
}

export function PlannedSetBadge({ plan }: { plan: PlannedSet }) {
  const reps = repRange(plan)
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
      <span
        aria-label="Tipo de set"
        className="font-bold px-1.5 py-0.5 rounded bg-primary/20 text-primary uppercase tracking-wider"
      >
        {labelFor(plan.setType)}
      </span>
      {reps && <span className="text-muted-foreground">{reps} reps</span>}
      {plan.targetWeightKg != null ? (
        <span className="text-muted-foreground">· {plan.targetWeightKg}kg</span>
      ) : plan.percentOfTopSet != null ? (
        <span className="text-muted-foreground">· {plan.percentOfTopSet}% top</span>
      ) : null}
      {plan.targetRpe != null && <span className="text-muted-foreground">· RPE {plan.targetRpe}</span>}
      {plan.targetRir != null && <span className="text-muted-foreground">· RIR {plan.targetRir}</span>}
      {plan.restSeconds != null && <span className="text-muted-foreground">· {plan.restSeconds}s</span>}
    </div>
  )
}
