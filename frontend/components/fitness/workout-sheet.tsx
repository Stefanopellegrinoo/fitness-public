"use client"

import { useEffect, useState } from "react"
import { Play, ChevronRight } from "lucide-react"
import { routineService } from "@/lib/api/routine.service"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { RoutineDay, RoutineDaySummary } from "@/lib/types/api.types"

interface WorkoutSheetProps {
  routine: {
    id: string
    name: string
    days: RoutineDay[]
  } | null
  onClose: () => void
  onStartWorkout?: (routineId: string, routineDayId: string) => void
}

export function WorkoutSheet({ routine, onClose, onStartWorkout }: WorkoutSheetProps) {
  // A SUMMARY, not a RoutineDay: the suggestion arrives without its exercises,
  // so the type has to stop short of promising them. The list below still reads
  // `day.exercises.length`, and it may — those days come from the routine the
  // parent already loaded, not from this request.
  const [suggested, setSuggested] = useState<RoutineDaySummary | null>(null)
  const routineId = routine?.id ?? null
  const hasDays = !!routine?.days.length

  useEffect(() => {
    if (!routineId || !hasDays) return

    // The server answers with today's anchored day when the routine has one,
    // and otherwise falls back to the rotation -- the day after the last
    // session that logged a set. That history lives on the server: the client
    // knows the days but never what was trained.
    let current = true
    setSuggested(null)

    routineService
      .getNextDay(routineId)
      .then(day => {
        if (current) setSuggested(day)
      })
      .catch(() => {
        // A suggestion is a shortcut, not a gate: if it cannot be fetched the
        // sheet still does its real job, listing the days to pick from. There
        // is deliberately no state change here — `suggested` was already reset
        // above and the failed request never set it. Absorbing the rejection IS
        // the whole job; without this the promise goes unhandled.
      })

    return () => {
      current = false
    }
  }, [routineId, hasDays])

  if (!routine) return null

  // Takes the id alone, so it serves both the full days of the list and the
  // summary the server suggests.
  const handleStartWorkout = (day: Pick<RoutineDay, "id">) => {
    onStartWorkout?.(routine.id, day.id)
    onClose()
  }

  return (
    <Sheet open={!!routine} onOpenChange={() => onClose()}>
      <SheetContent
        side="bottom"
        className="bg-card border-t border-border rounded-t-3xl px-4"
      >
        <SheetHeader className="text-center pb-4 px-0">
          <div className="w-12 h-1 bg-muted-foreground rounded-full mx-auto mb-4" />
          <SheetTitle className="text-foreground text-xl font-bold">
            {routine.name}
          </SheetTitle>
          <p className="text-muted-foreground text-sm">Elegí un día para entrenar</p>
          <SheetDescription className="sr-only">
            Opciones para iniciar tu entrenamiento
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-2 pb-6">
          {suggested && (
            <Button
              onClick={() => handleStartWorkout(suggested)}
              className="w-full justify-center gap-2 font-semibold py-4"
            >
              <Play className="h-4 w-4 fill-current" />
              Entrenar {suggested.name}
            </Button>
          )}
          {routine.days.map((day) => (
            <Button
              key={day.id}
              variant="ghost"
              onClick={() => handleStartWorkout(day)}
              className="w-full justify-between text-muted-foreground hover:text-foreground hover:bg-accent py-4"
            >
              <span className="flex items-center gap-2">
                <Play className="h-4 w-4 fill-current text-primary" />
                {day.name} · {day.exercises.length} ejercicios
              </span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
