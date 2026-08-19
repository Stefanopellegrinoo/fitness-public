"use client"

import { useState, useEffect } from "react"
import { X, TrendingUp, Calendar, Trophy, Loader2 } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/fitness/error-state"
import { workoutService } from "@/lib/api/workout.service"
import { WorkoutSession, Routine } from "@/lib/types/api.types"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts"

// Shared recessive tick styling so both axes read the same across charts.
const AXIS_TICK_STYLE = { fill: "var(--muted-foreground)", fontSize: 10 }

interface RoutineProgressSheetProps {
  routine: Routine
  open: boolean
  onClose: () => void
}

export function RoutineProgressSheet({ routine, open, onClose }: RoutineProgressSheetProps) {
  const [sessions, setSessions] = useState<WorkoutSession[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && routine.id) {
      fetchHistory()
    }
  }, [open, routine.id])

  const fetchHistory = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await workoutService.getSessions(routine.id)
      // Sort chronologically for the chart
      setSessions([...data].reverse())
    } catch (err) {
      setError("No pudimos cargar el historial de esta rutina. Revisá tu conexión e intentá de nuevo.")
      console.error("Failed to fetch routine history:", err)
    } finally {
      setIsLoading(false)
    }
  }

  // Calculate chart data: Total Volume per session
  const chartData = sessions.map((session) => {
    const totalVolume = session.sets.reduce(
      (acc, set) => acc + (set.weightKg * set.reps),
      0
    )
    return {
      date: format(new Date(session.startedAt), "dd/MM"),
      volumen: totalVolume,
      originalDate: session.startedAt,
    }
  })

  // Get PRs for each exercise in this routine
  const prs = routine.exercises.map((re) => {
    let maxWeight = 0
    sessions.forEach((session) => {
      session.sets.forEach((set) => {
        if (set.exerciseId === re.exerciseId && set.weightKg > maxWeight) {
          maxWeight = set.weightKg
        }
      })
    })
    return {
      name: re.exercise?.name || "Ejercicio",
      weight: maxWeight,
    }
  })

  return (
    <Sheet open={open} onOpenChange={() => onClose()}>
      <SheetContent
        side="bottom"
        className="bg-background border-t border-border rounded-t-3xl h-[85vh] overflow-y-auto px-4"
      >
        <SheetHeader className="flex flex-row items-center justify-between pb-6">
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </Button>
            <div>
              <SheetTitle className="text-foreground text-xl font-bold text-left">
                Progreso: {routine.name}
              </SheetTitle>
              <p className="text-muted-foreground text-sm text-left">Evolución y récords</p>
            </div>
          </div>
        </SheetHeader>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Analizando tu progreso...</p>
          </div>
        ) : error ? (
          <ErrorState description={error} onRetry={fetchHistory} />
        ) : sessions.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p>Todavía no tienes entrenamientos con esta rutina</p>
            <p className="text-sm mt-2">¡Empezá hoy mismo!</p>
          </div>
        ) : (
          <div className="space-y-8 pb-10">
            {/* Volume Chart */}
            <div className="bg-card rounded-2xl p-4 border border-border">
              <div className="flex items-center gap-2 mb-6">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h3 className="text-foreground/80 font-medium">Volumen Total (kg)</h3>
              </div>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorVol" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={AXIS_TICK_STYLE}
                    />
                    <YAxis
                      width={40}
                      domain={['auto', 'auto']}
                      tickLine={false}
                      axisLine={false}
                      tick={AXIS_TICK_STYLE}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: '8px' }}
                      labelStyle={{ color: 'var(--foreground)' }}
                      itemStyle={{ color: 'var(--foreground)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="volumen"
                      stroke="var(--chart-1)"
                      fillOpacity={1}
                      fill="url(#colorVol)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* PRs Section */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="h-4 w-4 text-chart-2" />
                <h3 className="text-foreground font-semibold">Tus Récords (PRs)</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {prs.filter(p => p.weight > 0).map((pr, idx) => (
                  <div key={idx} className="bg-card p-4 rounded-xl border border-border">
                    <p className="text-muted-foreground text-xs uppercase font-medium mb-1 truncate">{pr.name}</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-foreground">{pr.weight}</span>
                      <span className="text-muted-foreground text-sm">kg</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* History List */}
            <div>
              <h3 className="text-foreground font-semibold mb-4">Historial Reciente</h3>
              <div className="space-y-3">
                {sessions.slice().reverse().slice(0, 5).map((session) => (
                  <div key={session.id} className="flex items-center justify-between p-4 bg-muted rounded-xl border border-border">
                    <div className="flex items-center gap-3">
                      <div className="bg-card p-2 rounded-lg text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-foreground font-medium">
                          {format(new Date(session.startedAt), "eeee d 'de' MMMM", { locale: es })}
                        </p>
                        <p className="text-muted-foreground text-sm">
                          {session.sets.length} series completadas
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-primary font-bold">
                        {Math.round(session.sets.reduce((acc, set) => acc + (set.weightKg * set.reps), 0))}
                      </p>
                      <p className="text-muted-foreground text-xs uppercase">VOLUMEN KG</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
