"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { ArrowLeft, Settings, Plus, Clock, Pause, Play, Volume2, Timer, X, Target, Dumbbell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/fitness/empty-state"
import { ExerciseHistorySheet } from "./exercise-history-sheet"
import { ExerciseSelector } from "./exercise-selector"
import { workoutService, WorkoutSet } from "@/lib/api/workout.service"
import { apiErrorStatus } from "@/lib/api/error.handler"
import { notificationService } from "@/lib/api/notification.service"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import type { PlannedSet } from "@/lib/types/api.types"
import { computeSuggestedWeight } from "@/lib/workouts/suggested-weight"
import { formatSessionTime } from "@/lib/workouts/format-time"
import type { SessionSet, SessionExercise } from "@/lib/workouts/session-exercises"
import { ActiveSetRow } from "@/components/fitness/workout/active-set-row"

type Set = SessionSet
type Exercise = SessionExercise

interface ActiveWorkoutProps {
  sessionId: string
  routineName: string
  startedAt: string
  exercises: Exercise[]
  onFinish: () => void
  onBack: () => void
  // Separate from `onBack` on purpose: leaving a dead session must REPLACE the URL,
  // not push onto it. See handleSessionGone.
  onSessionGone: () => void
}

const REST_END_KEY = "workout_rest_end_at";
// How long the eject stays latched. Long enough to swallow the burst of failures one
// tap can produce, short enough that the screen answers again if the navigation never
// took the user away.
const EJECT_LATCH_MS = 3000;

export function ActiveWorkout({
  sessionId,
  routineName,
  startedAt,
  exercises: initialExercises,
  onFinish,
  onBack,
  onSessionGone,
}: ActiveWorkoutProps) {
  // --- STATE ---
  const [exercises, setExercises] = useState<Exercise[]>(initialExercises)
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(0)
  const [sessionTime, setSessionTime] = useState(0)
  const [restTimer, setRestTimer] = useState(0)
  const [isResting, setIsResting] = useState(false)
  const [restDuration, setRestDuration] = useState(90)
  const [showExerciseSelector, setShowExerciseSelector] = useState(false)
  const [showSettingsSheet, setShowSettingsSheet] = useState(false)
  const [selectedHistoryExercise, setSelectedHistoryExercise] = useState<Exercise | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [ghostSets, setGhostSets] = useState<Record<string, any[]>>({})

  const activeExercise = exercises[activeExerciseIndex]

  const heaviestLoggedNonWarmup = (ex: Exercise): number | null => {
    const weights = ex.sets.filter((s) => s.completed && s.plan?.setType !== "WARMUP").map((s) => s.weight)
    return weights.length ? Math.max(...weights) : null
  }
  const suggestionFor = (ex: Exercise, s: Set): number | undefined =>
    s.completed || !s.plan ? undefined : computeSuggestedWeight(s.plan, heaviestLoggedNonWarmup(ex))

  // --- TIMER SESIÓN ---
  useEffect(() => {
    const startTime = new Date(startedAt).getTime()
    const interval = setInterval(() => {
      setSessionTime(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  // --- RECUPEAR TIMER DESCANSO (LOCALSTORAGE) ---
  useEffect(() => {
    const savedRestEnd = localStorage.getItem(REST_END_KEY);
    if (!savedRestEnd) return
    const endAt = parseInt(savedRestEnd, 10);
    const remaining = Math.floor((endAt - Date.now()) / 1000);
    if (remaining > 0) {
      setRestTimer(remaining);
      setIsResting(true);
    } else {
      localStorage.removeItem(REST_END_KEY);
    }
  }, []);

  // --- TIMER DESCANSO (RUNNING) ---
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isResting && restTimer > 0) {
      interval = setInterval(() => {
        setRestTimer((prev) => {
          if (prev <= 1) { handleRestEnd(); return 0 }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [isResting, restTimer])

  // --- CARGAR HISTORIAL (GHOST SETS) ---
  useEffect(() => {
    const fetchAllHistory = async () => {
      const historyMap: Record<string, any[]> = {};
      await Promise.all(exercises.map(async (ex) => {
        try {
          const history = await workoutService.getExerciseHistory(ex.id, sessionId);
          if (history && history.length > 0) historyMap[ex.id] = history;
        } catch (e) {
          console.warn(`Failed to fetch history for ${ex.name}`);
        }
      }));
      setGhostSets(historyMap);
    };
    fetchAllHistory();
  }, [initialExercises.length, sessionId]);

  const handleRestEnd = async () => {
    setIsResting(false)
    localStorage.removeItem(REST_END_KEY);
    try {
      await notificationService.sendTestNotification()
      toast.info("¡Descanso terminado!", { icon: "💪" })
    } catch (e) {
      console.warn("Notification failed")
    }
  }

  // --- HELPERS ---
  const startRest = (duration?: number) => {
    const d = duration ?? restDuration
    const endAt = Date.now() + d * 1000;
    localStorage.setItem(REST_END_KEY, endAt.toString());
    setRestDuration(d)
    setRestTimer(d)
    setIsResting(true)
  }

  // Latched: concurrent writes fail together, and firing per failure stacks identical
  // toasts and history entries. `onSessionGone` REPLACES the URL — pushing leaves the
  // dead URL one Back tap away, where loading it silently starts a brand-new workout.
  const hasEjected = useRef(false)
  const handleSessionGone = (reason: 'closed' | 'missing') => {
    if (hasEjected.current) return
    hasEjected.current = true
    // The rest timer has to die with the session: its interval survives the
    // navigation and would fire "¡Descanso terminado!" after the user is thrown out.
    setIsResting(false)
    localStorage.removeItem(REST_END_KEY)
    toast.error(reason === 'closed'
      ? "Este entrenamiento ya fue finalizado. Volvé a empezar para seguir registrando."
      : "Este entrenamiento ya no está disponible. Volvé a empezar para seguir registrando.")
    onSessionGone()
    // The latch collapses one tap's burst of failures; it must not silence the screen
    // for good. `onSessionGone` is an async transition and this component stays mounted
    // and tappable while it resolves — if it never resolves (offline, a failed payload
    // fetch), every later write would fail with no toast at all.
    setTimeout(() => { hasEjected.current = false }, EJECT_LATCH_MS)
  }

  // Both answers mean this screen can never write again: 409 (the session is
  // finished) and 404 (the id is not the caller's). `sessionId` is fixed at mount, so
  // retrying cannot fix either. Returns true when it took over.
  const ejectIfSessionGone = (error: unknown): boolean => {
    const status = apiErrorStatus(error)
    if (status === 409) { handleSessionGone('closed'); return true }
    if (status === 404) { handleSessionGone('missing'); return true }
    return false
  }

  // On /workouts/sets/:id a 404 is about the SET row, not the session — the session
  // may be perfectly alive — so only the 409 ejects there.
  const ejectIfSessionClosed = (error: unknown): boolean => {
    if (apiErrorStatus(error) !== 409) return false
    handleSessionGone('closed')
    return true
  }

  // --- ACTIONS ---
  const addExerciseToSession = async (exercise: any) => {
    if (exercises.some(ex => ex.id === exercise.id)) {
      setActiveExerciseIndex(exercises.findIndex(ex => ex.id === exercise.id))
      return
    }
    try {
      setIsSyncing(true)
      await workoutService.linkExerciseToSession(sessionId, exercise.id)

      // Intentar traer historial para el nuevo ejercicio
      let initialSets: Set[] = [{ id: `temp-${Date.now()}`, weight: 0, reps: 10, completed: false }];
      try {
        const history = await workoutService.getExerciseHistory(exercise.id, sessionId);
        if (history && history.length > 0) {
          setGhostSets(prev => ({ ...prev, [exercise.id]: history }));
          // Usar los valores de la primera serie del historial como sugerencia
          initialSets = [{ id: `temp-${Date.now()}`, weight: history[0].weightKg, reps: history[0].reps, completed: false }];
        }
      } catch (e) { /* ignore history error */ }

      const newEx: Exercise = { id: exercise.id, name: exercise.name, muscleGroup: exercise.category, sets: initialSets }
      setExercises(prev => [...prev, newEx])
      setActiveExerciseIndex(exercises.length)
      toast.success(`${exercise.name} agregado`)
    } catch (error) {
      if (ejectIfSessionGone(error)) return
      console.error("Error adding exercise to session:", error)
      toast.error("No pudimos agregar el ejercicio. Intentá de nuevo.")
    } finally {
      setIsSyncing(false)
    }
  }

  const applySetChange = (exerciseId: string, setId: string, field: "weight" | "reps", compute: (base: number) => number) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exerciseId) return ex
      return {
        ...ex,
        sets: ex.sets.map(s => {
          if (s.id !== setId) return s
          const base = field === "weight" ? (s.weight || suggestionFor(ex, s) || 0) : s.reps
          const newVal = Math.max(0, compute(base))
          if (s.completed && !s.id.startsWith('temp-')) {
            workoutService.updateWorkoutSet(s.id, { [field === 'weight' ? 'weightKg' : 'reps']: newVal })
              .catch((e) => { if (!ejectIfSessionClosed(e)) console.error("Auto-sync failed") })
          }
          return { ...s, [field]: newVal }
        })
      }
    }))
  }

  const updateSet = (exerciseId: string, setId: string, field: "weight" | "reps", delta: number) =>
    applySetChange(exerciseId, setId, field, base => base + delta)

  const setSetWeight = (exerciseId: string, setId: string, value: number) =>
    applySetChange(exerciseId, setId, "weight", () => value)

  const handleSetAction = async (exerciseId: string, setId: string) => {
    const ex = exercises.find(e => e.id === exerciseId)
    const set = ex?.sets.find(s => s.id === setId)
    if (!set) return

    if (set.completed) {
      // Drops the server id and renders the set as pending again. A 404 shares it with
      // the success path on purpose: both mean the row is gone server-side. Toasting
      // "esa serie ya no existe" while still drawing it as logged leaves the row stuck
      // — every later tap re-sends the same DELETE and gets the same 404, forever.
      const unmarkLocally = () => setExercises(prev => prev.map(e => e.id === exerciseId
        ? { ...e, sets: e.sets.map(s => s.id === setId ? { ...s, id: `temp-${Date.now()}`, completed: false } : s) }
        : e))
      try {
        await workoutService.deleteWorkoutSet(setId)
        unmarkLocally()
      } catch (e) {
        if (ejectIfSessionClosed(e)) return
        if (apiErrorStatus(e) === 404) {
          unmarkLocally()
          toast.error("Esa serie ya no existe en el servidor.")
          return
        }
        console.error("Error unmarking set:", e)
        toast.error("No pudimos desmarcar la serie. Intentá de nuevo.")
      }
    } else {
      try {
        const setNumber = ex!.sets.indexOf(set) + 1
        const effWeight = set.weight || suggestionFor(ex!, set) || 0
        const saved = await workoutService.addWorkoutSet(sessionId, {
          exerciseId, setNumber, weightKg: effWeight, reps: set.reps,
          ...(set.plan?.setType ? { setType: set.plan.setType } : {}),
        })
        setExercises(prev => prev.map(e => e.id === exerciseId
          ? { ...e, sets: e.sets.map(s => s.id === setId ? { ...s, id: saved.id, weight: effWeight, completed: true } : s) }
          : e))
        startRest(set.plan?.restSeconds ?? undefined)
      } catch (e) {
        if (ejectIfSessionGone(e)) return
        console.error("Error saving set:", e)
        toast.error("No pudimos guardar la serie. Revisá tu conexión e intentá de nuevo.")
      }
    }
  }

  const addNewSet = (exerciseId: string) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exerciseId) return ex
      const lastSet = ex.sets[ex.sets.length - 1]
      const setNumber = ex.sets.length + 1;
      // Buscar sugerencia en el historial para este setNumber
      const history = ghostSets[exerciseId];
      const historySet = history?.find(h => h.setNumber === setNumber) || history?.[history.length - 1];
      return {
        ...ex,
        sets: [...ex.sets, { id: `temp-${Date.now()}`, weight: historySet?.weightKg || lastSet?.weight || 0, reps: historySet?.reps || lastSet?.reps || 10, completed: false }]
      }
    }))
  }

  const removeSet = async (exerciseId: string, setId: string) => {
    if (!setId.startsWith('temp-') && !setId.startsWith('plan-')) {
      try {
        await workoutService.deleteWorkoutSet(setId)
      } catch (e) {
        if (ejectIfSessionClosed(e)) return
        // A 404 is the outcome the tap asked for: the row is already gone server-side.
        // Keeping it on screen behind "intentá de nuevo" strands it, since every retry
        // deletes the same missing id. Fall through and drop it locally.
        if (apiErrorStatus(e) !== 404) {
          console.error("Error deleting set:", e)
          toast.error("No pudimos borrar la serie. Intentá de nuevo.")
          return
        }
      }
    }
    setExercises(prev => prev.map(ex => ex.id === exerciseId ? { ...ex, sets: ex.sets.filter(s => s.id !== setId) } : ex))
  }

  const handleFinishWorkout = () => {
    localStorage.removeItem(REST_END_KEY);
    onFinish();
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="flex items-center justify-between px-4 py-4 border-b border-border bg-background">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} className="text-muted-foreground"><ArrowLeft className="h-5 w-5" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setShowSettingsSheet(true)} className="text-muted-foreground"><Settings className="h-5 w-5" /></Button>
        </div>
        <div className="text-center">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">{routineName}</p>
          <p className="text-foreground font-mono text-lg tabular-nums-data">{formatSessionTime(sessionTime)}</p>
        </div>
        <Button onClick={handleFinishWorkout} className="bg-success hover:bg-success/90 text-success-foreground font-bold">Finalizar</Button>
      </header>

      {/* TABS DE EJERCICIOS */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto border-b border-border scrollbar-hide">
        {exercises.map((ex, i) => (
          <Button
            key={ex.id + i}
            variant={i === activeExerciseIndex ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveExerciseIndex(i)}
            className={cn("whitespace-nowrap text-xs font-semibold", i !== activeExerciseIndex && "border-border text-muted-foreground")}
          >
            {ex.name.toUpperCase()}
          </Button>
        ))}
        <Button variant="ghost" size="icon" onClick={() => setShowExerciseSelector(true)} aria-label="Agregar ejercicio" className="text-primary shrink-0"><Plus className="h-5 w-5" /></Button>
      </div>

      <main className="px-4 py-6 max-w-lg mx-auto">
        {/* TIMER DE DESCANSO */}
        {isResting && (
          <div className="flex flex-col items-center py-8 bg-primary/5 border-y border-primary/10 mb-6">
            <div className="flex gap-2 mb-6">
              {[60, 90, 120, 180].map(d => (
                <Button key={d} variant={restDuration === d ? "default" : "outline"} size="sm" onClick={() => { setRestDuration(d); setRestTimer(d); }} className="h-8 text-[10px] font-bold">
                  {d}s
                </Button>
              ))}
            </div>
            <div className="relative w-32 h-32">
              <svg className="w-full h-full -rotate-90">
                <circle cx="64" cy="64" r="60" fill="none" stroke="currentColor" strokeWidth="4" className="text-border" />
                <circle cx="64" cy="64" r="60" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray={377} strokeDashoffset={377 - (377 * restTimer) / restDuration} className="text-primary transition-all duration-1000 linear" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-foreground font-bold text-3xl">{formatSessionTime(restTimer)}</span>
                <span className="text-[8px] text-primary font-bold uppercase tracking-widest">Descanso</span>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button variant="ghost" size="sm" onClick={() => { setIsResting(false); localStorage.removeItem(REST_END_KEY); }} className="text-muted-foreground">
                <Pause className="h-4 w-4 mr-2" /> Pausar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setRestTimer(0); setIsResting(false); localStorage.removeItem(REST_END_KEY); }} className="text-primary font-bold">
                Saltar →
              </Button>
            </div>
          </div>
        )}

        {/* EJERCICIO ACTIVO */}
        {activeExercise && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-foreground font-bold text-xl">{activeExercise.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-primary/20 text-primary uppercase">{activeExercise.muscleGroup}</span>
                  {activeExercise.targetSets && (
                    <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">Meta: {activeExercise.targetSets}x{activeExercise.targetReps}</span>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSelectedHistoryExercise(activeExercise)} className="text-muted-foreground hover:text-foreground"><Clock className="h-5 w-5" /></Button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center text-muted-foreground text-[10px] font-bold uppercase tracking-widest px-2">
                <span className="w-8">#</span>
                <span className="flex-1 text-center">Peso (KG)</span>
                <span className="w-24 text-center">Reps</span>
                <span className="w-20" />
              </div>

              {activeExercise.sets.map((set, idx) => {
                const setNumber = idx + 1
                const historySet = ghostSets[activeExercise.id]?.find((h) => h.setNumber === setNumber)
                return (
                  <ActiveSetRow
                    key={set.id}
                    set={set}
                    index={setNumber}
                    suggestedWeight={suggestionFor(activeExercise, set)}
                    ghost={!set.completed && historySet ? { weightKg: historySet.weightKg, reps: historySet.reps } : undefined}
                    onUpdate={(field, delta) => updateSet(activeExercise.id, set.id, field, delta)}
                    onSetWeight={(value) => setSetWeight(activeExercise.id, set.id, value)}
                    onToggle={() => handleSetAction(activeExercise.id, set.id)}
                    onRemove={() => removeSet(activeExercise.id, set.id)}
                  />
                )
              })}

              <Button variant="ghost" className="w-full h-14 border-2 border-dashed border-border text-primary font-bold uppercase text-xs tracking-widest mt-4" onClick={() => addNewSet(activeExercise.id)}>
                <Plus className="h-4 w-4 mr-2" /> Agregar Serie
              </Button>
            </div>
          </div>
        )}

        {/* SIN EJERCICIOS TODAVÍA */}
        {!activeExercise && (
          <EmptyState
            icon={Dumbbell}
            title="Arrancá tu entrenamiento"
            description="Agregá el primer ejercicio para empezar a registrar series"
            actionLabel="Agregar ejercicio"
            onAction={() => setShowExerciseSelector(true)}
          />
        )}
      </main>

      {/* CONFIGURACIÓN DE DESCANSO */}
      <Sheet open={showSettingsSheet} onOpenChange={setShowSettingsSheet}>
        <SheetContent side="bottom" className="bg-background border-t border-border rounded-t-3xl pb-12">
          <SheetHeader className="mb-8">
            <SheetTitle className="text-foreground font-bold">Configuración de Sesión</SheetTitle>
            <SheetDescription className="text-muted-foreground">Ajusta el tiempo de descanso por defecto</SheetDescription>
          </SheetHeader>
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between text-foreground font-semibold">
                <span>Tiempo de Descanso</span>
                <span className="text-primary">{restDuration}s</span>
              </div>
              <Slider value={[restDuration]} onValueChange={(val) => setRestDuration(val[0])} max={300} min={30} step={5} />
            </div>
            <Button onClick={() => setShowSettingsSheet(false)} className="w-full font-semibold">Confirmar</Button>
          </div>
        </SheetContent>
      </Sheet>

      <ExerciseHistorySheet exercise={selectedHistoryExercise} onClose={() => setSelectedHistoryExercise(null)} />
      <ExerciseSelector open={showExerciseSelector} onClose={() => setShowExerciseSelector(false)} onSelect={addExerciseToSession} />
    </div>
  )
}
