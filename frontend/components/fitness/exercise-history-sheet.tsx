"use client"

import { useEffect, useState } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Clock, TrendingUp, Calendar, X } from "lucide-react"
import { getExerciseProgression, getExercisePRs } from "@/lib/api/stats.service"
import type { ExercisePRs, ProgressionPoint } from "@/lib/api/stats.service"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

interface ExerciseHistorySheetProps {
  exercise: {
    id: string
    name: string
    muscleGroup: string
  } | null
  onClose: () => void
}

// How many past sessions of this exercise the sheet reads. The chart is ~300px
// wide, so more points than this stop being legible before they stop being
// available -- and the record comes from the PR endpoint, which reads the whole
// history, so a deeper window would not surface anything the header misses.
const SESSION_WINDOW = 20

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; progression: ProgressionPoint[]; prs: ExercisePRs }

const chartConfig = {
  weight: {
    label: "Peso",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

// Shared recessive tick styling so both axes read the same across charts.
const AXIS_TICK_STYLE = { fill: "var(--muted-foreground)", fontSize: 10 }

export function ExerciseHistorySheet({ exercise, onClose }: ExerciseHistorySheetProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const exerciseId = exercise?.id ?? null

  useEffect(() => {
    if (!exerciseId) return

    // Guards the response against an exercise the user has already moved on
    // from: two sheets opened in a row resolve in whatever order the network
    // decides, and the slower FIRST request would otherwise paint its history
    // over the second exercise's.
    let current = true
    setState({ status: "loading" })

    Promise.all([
      getExerciseProgression(exerciseId, SESSION_WINDOW),
      getExercisePRs(exerciseId),
    ])
      .then(([progression, prs]) => {
        if (current) setState({ status: "ready", progression, prs })
      })
      .catch(() => {
        // A failed load must not fall through to the empty state: "you never
        // trained this" is a lie to someone who trained it yesterday.
        if (current) setState({ status: "error" })
      })

    return () => {
      current = false
    }
  }, [exerciseId])

  if (!exercise) return null

  const ready = state.status === "ready" ? state : null
  // Newest first, and the API hands them back oldest-first for the chart, so
  // the list reverses a copy rather than the array the chart reads.
  const sessions = ready ? [...ready.progression].reverse() : []
  const record = ready?.prs.weightPRs.at(-1) ?? null
  const maxVolume = ready?.progression.reduce((best, p) => Math.max(best, p.volume), 0) ?? 0
  const chartPoints = (ready?.progression ?? [])
    .filter(p => p.topSetWeight !== null)
    .map(p => ({ date: format(new Date(p.date), "d MMM", { locale: es }), weight: p.topSetWeight }))

  return (
    <Sheet open={!!exercise} onOpenChange={() => onClose()}>
      <SheetContent
        side="bottom"
        className="bg-card border-t border-border rounded-t-3xl h-[85vh] overflow-y-auto px-4"
      >
        <SheetHeader className="flex flex-row items-center justify-between pb-4 px-0">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <SheetTitle className="text-foreground text-lg font-bold text-left">
                Historial
              </SheetTitle>
              <p className="text-muted-foreground text-sm">{exercise.name}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </Button>
          <SheetDescription className="sr-only">
            Ver historial y estadísticas del ejercicio
          </SheetDescription>
        </SheetHeader>

        {state.status === "loading" && (
          <p className="text-muted-foreground text-sm py-8 text-center">Cargando historial…</p>
        )}

        {state.status === "error" && (
          <p className="text-muted-foreground text-sm py-8 text-center">
            No pudimos cargar el historial de este ejercicio.
          </p>
        )}

        {ready && sessions.length === 0 && (
          <p className="text-muted-foreground text-sm py-8 text-center">
            Todavía no registraste series de este ejercicio.
          </p>
        )}

        {ready && sessions.length > 0 && (
          <>
        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard
            label="TU RÉCORD"
            value={record ? `${record.weightKg}kg` : "—"}
            subValue={record ? `× ${record.reps} reps` : "sin marcas"}
          />
          <StatCard
            label="VOL. MÁXIMO"
            value={maxVolume.toString()}
            subValue="kg totales"
          />
          <StatCard
            label="FRECUENCIA"
            value={sessions.length.toString()}
            subValue="sesiones"
          />
        </div>

        {/* Progression Chart */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground text-sm">Progresión de Peso (kg)</span>
          </div>
          <ChartContainer config={chartConfig} className="h-[120px] w-full">
            <LineChart data={chartPoints}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK_STYLE}
              />
              <YAxis
                domain={["dataMin - 2", "dataMax + 2"]}
                width={28}
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK_STYLE}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                type="monotone"
                dataKey="weight"
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={{ fill: "var(--chart-1)", strokeWidth: 0, r: 4 }}
              />
            </LineChart>
          </ChartContainer>
        </div>

        {/* Session History */}
        <div className="space-y-4">
          {sessions.map((session) => (
            <div key={session.sessionId} className="border-t border-border pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="h-4 w-4 text-primary" />
                <span className="text-foreground font-medium">
                  {format(new Date(session.date), "EEEE d 'de' MMMM", { locale: es })}
                </span>
              </div>
              <div className="space-y-2">
                {session.sets.map((set) => (
                  <div
                    key={set.setNumber}
                    className="flex items-center justify-between px-3 py-2 bg-muted rounded-lg"
                  >
                    <span className="text-muted-foreground">
                      <span className="text-foreground font-medium">{set.weightKg}</span> kg
                    </span>
                    <span className="text-muted-foreground">
                      <span className="text-foreground font-medium">{set.reps}</span> reps
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function StatCard({
  label,
  value,
  subValue,
}: {
  label: string
  value: string
  subValue: string
}) {
  return (
    <div className="bg-secondary rounded-xl p-3 text-center">
      <p className="text-muted-foreground text-[10px] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-foreground font-bold text-lg">{value}</p>
      <p className="text-primary text-xs">{subValue}</p>
    </div>
  )
}
