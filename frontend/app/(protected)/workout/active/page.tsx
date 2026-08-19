"use client"

import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Dumbbell } from "lucide-react"
import { ActiveWorkout } from "@/components/fitness/active-workout"
import { EmptyState } from "@/components/fitness/empty-state"
import { ErrorState } from "@/components/fitness/error-state"
import { Button } from "@/components/ui/button"
import { Suspense, useEffect, useState, useCallback, useRef } from "react"
import { toast } from "sonner"
import { workoutService } from "@/lib/api/workout.service"
import { apiErrorStatus } from "@/lib/api/error.handler"
import { buildSessionExercises } from "@/lib/workouts/session-exercises"
import { resolveSessionAction } from "@/lib/workouts/session-action"

function ActiveWorkoutContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Support both 'routineId' and 'routine' for backward compatibility
  const routineId = searchParams.get("routineId") || searchParams.get("routine") || undefined
  const forceDay = searchParams.get("day") || undefined
  const routineDayId = searchParams.get("routineDayId") || undefined

  const [session, setSession] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  // Guards against double session creation (StrictMode double-effect, rapid param changes)
  const startInFlight = useRef(false)
  // Same guard for the other end. The Finalizar button has no disabled state and no
  // debounce, and `session` is not cleared until after the await, so `if (!session)`
  // lets a second tap straight through. The server is idempotent, so the damage is not
  // to the data — it is two toasts and two navigations, and on a slow connection the
  // two taps do not even resolve the same way: the first can time out at 10s while the
  // second succeeds, and the user is told both that it failed and that it worked.
  const finishInFlight = useRef(false)

  const getClientDay = () => {
    if (forceDay) return forceDay.toUpperCase();
    const days = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO']
    return days[new Date().getDay()]
  }

  const loadSession = useCallback(async () => {
    try {
      setIsLoading(true)
      setLoadError(false)
      const activeSession = await workoutService.getActiveWorkout()

      const action = resolveSessionAction(activeSession, routineId)

      if (action === 'start-requested') {
        if (startInFlight.current) return
        startInFlight.current = true
        try {
          const newSession = await workoutService.startWorkout(routineId, getClientDay(), routineDayId)
          setSession(newSession)
        } finally {
          startInFlight.current = false
        }
      } else if (action === 'resume') {
        setSession(activeSession)
      } else {
        // No active session and no explicit routine: never start implicitly.
        setSession(null)
      }
    } catch (error) {
      console.error("Error loading session:", error)
      setLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }, [routineId, forceDay, routineDayId])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  const handleStartFreeWorkout = async () => {
    if (startInFlight.current) return
    startInFlight.current = true
    try {
      setIsStarting(true)
      const newSession = await workoutService.startWorkout(undefined, getClientDay(), undefined)
      setSession(newSession)
    } catch (error) {
      console.error("Error starting free workout:", error)
      toast.error("No pudimos iniciar el entrenamiento. Revisá tu conexión e intentá de nuevo.")
    } finally {
      setIsStarting(false)
      startInFlight.current = false
    }
  }

  const handleFinish = async () => {
    if (!session || finishInFlight.current) return
    finishInFlight.current = true
    try {
      await workoutService.finishWorkout(session.id)
      setSession(null) // Clean state immediately
      toast.success("¡Entrenamiento finalizado!")
      router.replace("/workout") // Use replace to avoid back-button issues
    } catch (error) {
      // A 404 from the finish handler means the id names nothing this user owns, so
      // retrying can never work — and "Intentá de nuevo" strands them on a screen whose
      // only exit is the button that just failed. Eject instead, with the same copy the
      // rest of the app uses for a session that is gone. Finishing twice does NOT land
      // here: the server answers the second call 200 with the untouched row.
      //
      // `apiErrorStatus`, not a plain 404 check: the express catch-all and anything in
      // front of it answer 404 for a session that is perfectly alive, and ejecting on
      // those both lies and traps — /workout hands the session straight back, and the
      // only way out is the button that ejects again.
      if (apiErrorStatus(error) === 404) {
        setSession(null)
        toast.error("Este entrenamiento ya no está disponible. Volvé a empezar para seguir registrando.")
        router.replace("/workout") // replace, not push: the dead URL silently starts a new workout
        return
      }
      console.error("Error finishing workout:", error)
      toast.error("No pudimos finalizar el entrenamiento. Intentá de nuevo.")
    } finally {
      // Released even on the eject paths: `router.replace` is an async transition and
      // this page stays mounted while it resolves. Latching it shut for good would
      // silence a screen the user can still see.
      finishInFlight.current = false
    }
  }

  if (isLoading || isStarting) {
    return (
      <div className="min-h-dvh bg-background flex flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 rounded-full border-2 border-t-primary border-border animate-spin" />
        <p className="text-sm text-muted-foreground">
          {isStarting ? "Iniciando entrenamiento..." : "Cargando entrenamiento..."}
        </p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center px-4">
        <ErrorState
          description="No pudimos cargar tu entrenamiento. Revisá tu conexión e intentá de nuevo."
          onRetry={loadSession}
        />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-dvh bg-background flex flex-col items-center justify-center px-4">
        <EmptyState
          icon={Dumbbell}
          title="No hay entrenamiento en curso"
          description="Elegí una rutina para arrancar, o empezá un entrenamiento libre"
          actionLabel="Empezar entrenamiento libre"
          onAction={handleStartFreeWorkout}
        />
        <Button asChild variant="outline" className="mt-3">
          <Link href="/workout">Ver mis rutinas</Link>
        </Button>
      </div>
    )
  }

  // Delegate to the shared helper so plan-driven rows (with plan snapshot / setType) reach ActiveWorkout.
  const reconstructExercises = () => buildSessionExercises(session)

  return (
    <ActiveWorkout
      sessionId={session.id}
      routineName={session.routine?.name || "Entrenamiento Libre"}
      startedAt={session.startedAt}
      exercises={reconstructExercises()}
      onFinish={handleFinish}
      onBack={() => router.push("/workout")}
      // replace, like handleFinish: pushing would leave the dead URL one Back tap
      // away, and loading it starts a brand-new session instead of resuming.
      onSessionGone={() => router.replace("/workout")}
    />
  )
}

export default function ActiveWorkoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-background flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Cargando...</p>
        </div>
      }
    >
      <ActiveWorkoutContent />
    </Suspense>
  )
}
