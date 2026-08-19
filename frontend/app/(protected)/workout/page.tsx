"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Plus, Search, Clock, Dumbbell, Pencil, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { WorkoutSheet } from "@/components/fitness/workout-sheet"
import { RoutineProgressSheet } from "@/components/fitness/routine-progress-sheet"
import { EmptyState } from "@/components/fitness/empty-state"
import { ErrorState } from "@/components/fitness/error-state"
import { routineService } from "@/lib/api/routine.service"
import { Routine } from "@/lib/types/api.types"
import { isAuthError, isNetworkError } from "@/lib/api/error.handler"
import { capitalizeFirst } from "@/lib/utils"

export default function WorkoutPage() {
  const router = useRouter()
  const [routines, setRoutines] = useState<Routine[]>([])
  const [selectedRoutine, setSelectedRoutine] = useState<Routine | null>(null)
  const [progressRoutine, setProgressRoutine] = useState<Routine | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const today = capitalizeFirst(new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }))

  const fetchRoutines = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const data = await routineService.getAll()
      setRoutines(data)
    } catch (err) {


      if (isAuthError(err)) {
        setError("Tu sesión expiró. Iniciá sesión de nuevo.")
      } else if (isNetworkError(err)) {
        setError("Estás sin conexión. Revisá tu internet e intentá de nuevo.")
      } else {
        setError("No pudimos cargar los datos. Intentá de nuevo en un momento.")
      }

      console.error("Failed to fetch routines:", err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchRoutines()
  }, [])

  const handleStartWorkout = (routineId: string, routineDayId?: string) => {
    const query = routineDayId
      ? `?routineId=${routineId}&routineDayId=${routineDayId}`
      : `?routineId=${routineId}`
    router.push(`/workout/active${query}`)
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-accent">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Entrenamiento</h1>
            <p className="text-muted-foreground text-sm">{today}</p>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <Spinner className="w-8 h-8" />
          <p className="text-sm text-muted-foreground">Cargando rutinas...</p>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <ErrorState description={error} onRetry={fetchRoutines} />
      )}

      {/* Routines Section */}
      {!isLoading && !error && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-foreground font-semibold">Tus Rutinas</h2>
            <Link href="/workout/routines/create">
              <Button size="sm" variant="outline" className="border-primary/40 text-primary hover:bg-primary/10">
                <Plus className="h-4 w-4 mr-1" />
                Nueva Rutina
              </Button>
            </Link>
          </div>

          {routines.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border">
              <EmptyState
                icon={Dumbbell}
                title="No tenés rutinas creadas"
                description="Creá tu primera rutina para comenzar a entrenar"
                actionLabel="Nueva rutina"
                actionHref="/workout/routines/create"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-6 xl:grid-cols-3">
              {routines.map((routine) => (
                <div
                  key={routine.id}
                  onClick={() => setSelectedRoutine(routine)}
                  className="bg-card border border-border rounded-2xl p-4 cursor-pointer hover:border-primary/30 transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-display text-2xl font-semibold text-foreground capitalize">{routine.name}</h3>
                      <div className="flex items-center gap-3 text-muted-foreground text-sm mt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {(routine.days ?? []).length} Días
                        </span>
                        <span className="flex items-center gap-1">
                          <Dumbbell className="h-4 w-4" />
                          {(routine.days ?? []).reduce((n, d) => n + d.exercises.length, 0)} Ejercicios
                        </span>
                      </div>
                      {(routine.days ?? []).length > 0 && (
                        <div className="flex gap-2 mt-3">
                          {(routine.days ?? []).map((day) => (
                            <span
                              key={day.id}
                              className="text-xs px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/20"
                            >
                              {day.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-primary hover:text-foreground hover:bg-primary/10 bg-primary/5 border border-primary/20"
                        onClick={(e) => {
                          e.stopPropagation(); // Evita que se abra el WorkoutSheet
                          setProgressRoutine(routine);
                        }}
                      >
                        <Clock className="h-5 w-5" />
                      </Button>
                      <Link href={`/workout/routines/${routine.id}/edit`} onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-accent"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>

                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Workout Sheet */}
      {selectedRoutine && (
        <WorkoutSheet
          routine={{
            id: selectedRoutine.id,
            name: selectedRoutine.name,
            days: selectedRoutine.days,
          }}
          onClose={() => setSelectedRoutine(null)}
          onStartWorkout={handleStartWorkout}
        />
      )}

      {/* Progress Sheet */}
      {progressRoutine && (
        <RoutineProgressSheet
          routine={progressRoutine}
          open={!!progressRoutine}
          onClose={() => setProgressRoutine(null)}
        />
      )}
    </>
  )
}
