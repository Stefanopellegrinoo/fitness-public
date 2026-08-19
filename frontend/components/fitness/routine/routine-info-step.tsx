"use client"

import Link from "next/link"
import { ArrowLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import { daysOfWeek } from "@/components/fitness/routine/weekdays"

export interface RoutineInfoStepProps {
  mode: "create" | "edit"
  name: string
  onNameChange: (name: string) => void
  selectedDays: string[]
  onToggleDay: (code: string) => void
  error: string | null
  onNext: () => void
}

// Step 1 of the routine wizard: name + weekday selection.
export function RoutineInfoStep({
  mode,
  name,
  onNameChange,
  selectedDays,
  onToggleDay,
  error,
  onNext,
}: RoutineInfoStepProps) {
  return (
    <>
      <div className="flex items-center gap-3 mb-8">
        <Link href="/workout">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
          {mode === "create" ? "Nueva Rutina" : "Editar Rutina"}
        </h1>
      </div>

      <div className="mb-8">
        <label className="block text-xs font-medium text-primary uppercase tracking-wider mb-3">
          Nombre de la Rutina
        </label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Ej: Push / Pull / Legs"
          className="bg-transparent border-0 border-b border-border rounded-none px-0 py-3 text-foreground text-lg placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:border-muted-foreground"
        />
      </div>

      <div className="mb-8">
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
          Días de Entrenamiento
        </label>
        <div className="flex gap-2">
          {daysOfWeek.map((day) => (
            <button
              key={day.code}
              type="button"
              onClick={() => onToggleDay(day.code)}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all",
                selectedDays.includes(day.code)
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              {day.code}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-sm mt-3">
          Seleccioná los días y después cargás los ejercicios de cada uno.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <p>{error}</p>
        </Alert>
      )}

      <Button
        onClick={onNext}
        className="w-full py-6 text-base font-semibold"
        disabled={!name.trim() || selectedDays.length === 0}
      >
        Siguiente: Agregar ejercicios
        <ChevronRight className="h-5 w-5 ml-2" />
      </Button>
    </>
  )
}
