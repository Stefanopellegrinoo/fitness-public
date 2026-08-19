"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import { ArrowLeft, Scale, Dumbbell, Flame, Activity, TrendingUp, Calendar, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { EmptyState } from "@/components/fitness/empty-state"
import { ErrorState } from "@/components/fitness/error-state"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts"
import { progressService, BodyProgressPoint, WorkoutProgressPoint, NutritionProgressPoint } from "@/lib/api/progress.service"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { isAuthError, isNetworkError } from "@/lib/api/error.handler"

const chartConfig = {
  weight: { label: "Peso", color: "var(--chart-1)" },
  volume: { label: "Volumen", color: "var(--chart-1)" },
  calories: { label: "Calorías", color: "var(--chart-1)" },
} satisfies ChartConfig

// Shared recessive tick styling so both axes read the same across charts.
const AXIS_TICK_STYLE = { fill: "var(--muted-foreground)", fontSize: 10 }

// Direct bar labels: tonnes above 1t, kg below — always readable without hovering.
function formatVolumeLabel(kg: number) {
  return kg >= 1000 ? `${(kg / 1000).toFixed(1)}t` : `${Math.round(kg)}kg`
}

export default function ProgressPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<"30" | "90" | "180">("30")
  const [bodyData, setBodyData] = useState<BodyProgressPoint[]>([])
  const [workoutData, setWorkoutData] = useState<WorkoutProgressPoint[]>([])
  const [nutritionData, setNutritionData] = useState<NutritionProgressPoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const days = parseInt(selectedPeriod)
      const weeks = Math.ceil(days / 7)

      const [body, workouts, nutrition] = await Promise.all([
        progressService.getBodyProgress(days),
        progressService.getWorkoutProgress(weeks),
        progressService.getNutritionProgress(days)
      ])

      setBodyData(body)
      setWorkoutData(workouts)
      setNutritionData(nutrition)
    } catch (err) {


      if (isAuthError(err)) {
        setError("Tu sesión expiró. Iniciá sesión de nuevo.")
      } else if (isNetworkError(err)) {
        setError("Estás sin conexión. Revisá tu internet e intentá de nuevo.")
      } else {
        setError("No pudimos cargar los datos. Intentá de nuevo en un momento.")
      }

      console.error("Error fetching progress data:", err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [selectedPeriod])

  const stats = useMemo(() => {
    const lastWeight = bodyData[bodyData.length - 1]?.weight || 0
    const firstWeight = bodyData[0]?.weight || 0
    const weightDiff = lastWeight - firstWeight

    const totalVolume = workoutData.reduce((sum, p) => sum + p.volume, 0)
    const totalSessions = workoutData.reduce((sum, p) => sum + p.sessions, 0)
    // Weeks partition the calendar, so summing per-week distinct days gives total active days.
    const activeDays = workoutData.reduce((sum, p) => sum + p.activeDays, 0)

    const avgCalories = nutritionData.length > 0
      ? Math.round(nutritionData.reduce((sum, p) => sum + p.calories, 0) / nutritionData.length)
      : 0

    return {
      currentWeight: lastWeight || "--",
      weightDiff,
      totalVolume,
      totalSessions,
      activeDays,
      avgCalories
    }
  }, [bodyData, workoutData, nutritionData])

  const formattedBodyData = useMemo(() => {
    return bodyData.map(p => ({
      ...p,
      formattedDate: format(new Date(p.date), "d MMM", { locale: es })
    }))
  }, [bodyData])

  const formattedWorkoutData = useMemo(() => {
    return workoutData.map(p => ({
      ...p,
      formattedDate: format(new Date(p.date), "d MMM", { locale: es })
    }))
  }, [workoutData])

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-8 px-1 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-accent">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Progreso</h1>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-widest">Análisis de Rendimiento</p>
          </div>
        </div>
        <div className="flex bg-card p-1 rounded-xl border border-border">
          {(["30", "90", "180"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setSelectedPeriod(p)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold uppercase transition-all",
                selectedPeriod === p ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p}D
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Spinner className="w-10 h-10 mb-4 text-muted-foreground" />
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Cargando datos...</p>
        </div>
      ) : error ? (
        <ErrorState
          description="No pudimos cargar tu progreso. Revisá tu conexión e intentá de nuevo."
          onRetry={fetchData}
        />
      ) : (
        <div className="space-y-6">
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 gap-3 lg:gap-6">
            <div className="bg-card rounded-3xl p-5 border border-border shadow-xl">
              <div className="flex items-center gap-2 text-primary mb-3">
                <Scale className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Peso Actual</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl font-semibold text-foreground tabular-nums-data tracking-tight">{stats.currentWeight}</span>
                <span className="text-xs text-muted-foreground font-bold uppercase">kg</span>
              </div>
              <p className={cn(
                "text-xs font-bold uppercase mt-1",
                stats.weightDiff < 0 ? "text-success" : stats.weightDiff > 0 ? "text-destructive" : "text-muted-foreground"
              )}>
                {stats.weightDiff > 0 ? "+" : ""}{stats.weightDiff.toFixed(1)} kg en {selectedPeriod} días
              </p>
            </div>

            <div className="bg-card rounded-3xl p-5 border border-border shadow-xl">
              <div className="flex items-center gap-2 text-primary mb-3">
                <Flame className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Prom. Calorías</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl font-semibold text-foreground tabular-nums-data tracking-tight">{stats.avgCalories}</span>
                <span className="text-xs text-muted-foreground font-bold uppercase">kcal</span>
              </div>
              <p className="text-xs font-bold text-muted-foreground uppercase mt-1">Consumo Diario</p>
            </div>
          </div>

          {/* Charts */}
          <div className="space-y-6 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-6">
            {/* Weight Chart */}
            <section className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-foreground font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Evolución de Peso
                </h3>
              </div>
              <div className="bg-card border border-border rounded-3xl p-4 shadow-xl">
                {formattedBodyData.length < 2 ? (
                  <EmptyState
                    icon={Calendar}
                    title="Faltan datos para el gráfico"
                    description="Registrá al menos 2 mediciones de peso para ver la evolución"
                    actionLabel="Ir a métricas"
                    actionHref="/metrics"
                  />
                ) : (
                  <ChartContainer config={chartConfig} className="h-[180px] w-full">
                    <AreaChart data={formattedBodyData}>
                      <defs>
                        <linearGradient id="colorWeight" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="formattedDate"
                        tickLine={false}
                        axisLine={false}
                        tick={AXIS_TICK_STYLE}
                        minTickGap={30}
                      />
                      <YAxis
                        domain={['dataMin - 1', 'dataMax + 1']}
                        width={32}
                        tickLine={false}
                        axisLine={false}
                        tick={AXIS_TICK_STYLE}
                        tickFormatter={(value: number) => value.toFixed(1)}
                      />
                      <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                      <Area
                        type="monotone"
                        dataKey="weight"
                        stroke="var(--chart-1)"
                        strokeWidth={3}
                        fill="url(#colorWeight)"
                        animationDuration={1500}
                      />
                    </AreaChart>
                  </ChartContainer>
                )}
              </div>
            </section>

            {/* Workout Volume Chart */}
            <section className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-foreground font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                  <Dumbbell className="h-4 w-4 text-primary" />
                  Volumen Semanal
                </h3>
                <span className="text-xs font-semibold text-muted-foreground uppercase">{stats.totalSessions} {stats.totalSessions === 1 ? "sesión" : "sesiones"}</span>
              </div>
              <div className="bg-card border border-border rounded-3xl p-4 shadow-xl">
                {formattedWorkoutData.length === 0 ? (
                  <EmptyState
                    icon={Dumbbell}
                    title="Todavía no hay entrenamientos"
                    description="Completá tu primer entrenamiento para ver el volumen semanal"
                  />
                ) : (
                  <ChartContainer config={chartConfig} className="h-[180px] w-full">
                    <BarChart data={formattedWorkoutData} margin={{ top: 20 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="formattedDate"
                        tickLine={false}
                        axisLine={false}
                        tick={AXIS_TICK_STYLE}
                      />
                      <YAxis hide />
                      <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                      <Bar
                        dataKey="volume"
                        fill="var(--chart-1)"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={48}
                        animationDuration={1500}
                      >
                        <LabelList
                          dataKey="volume"
                          position="top"
                          formatter={(value: number) => formatVolumeLabel(value)}
                          fill="var(--muted-foreground)"
                          fontSize={10}
                        />
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                )}
              </div>
            </section>
          </div>

          {/* Performance Insights */}
          <div className="bg-card border border-border rounded-3xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-6 pointer-events-none">
              <TrendingUp className="h-20 w-24 text-foreground/5" />
            </div>
            <h3 className="text-foreground font-bold text-sm uppercase tracking-widest mb-4 flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Resumen de Logros
            </h3>
            <div className="space-y-4 relative z-10">
              <InsightItem
                label="Volumen Total"
                value={`${(stats.totalVolume / 1000).toFixed(1)} TN`}
                sub="Toneladas levantadas"
              />
              <InsightItem
                label="Consistencia"
                value={`${Math.round((stats.totalSessions / (parseInt(selectedPeriod) / 7)) * 10) / 10}`}
                sub="Sesiones por semana"
              />
              <InsightItem
                label="Días Activos"
                value={`${stats.activeDays} ${stats.activeDays === 1 ? "día" : "días"}`}
                sub={`En los últimos ${selectedPeriod} días`}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function InsightItem({ label, value, sub }: { label: string, value: string, sub: string }) {
  return (
    <div className="flex items-center justify-between group">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">{label}</p>
        <p className="text-muted-foreground text-xs font-bold leading-tight">{sub}</p>
      </div>
      <div className="text-right">
        <p className="font-display text-xl font-semibold text-foreground tabular-nums-data tracking-tight">{value}</p>
      </div>
    </div>
  )
}
