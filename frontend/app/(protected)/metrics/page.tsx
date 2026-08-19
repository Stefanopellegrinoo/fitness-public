"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ArrowLeft, Scale, Plus, Ruler, Activity, ChevronRight, History, TrendingUp, TrendingDown, Minus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AddMetricSheet } from "@/components/fitness/add-metric-sheet"
import { EmptyState } from "@/components/fitness/empty-state"
import { ErrorState } from "@/components/fitness/error-state"
import { metricsService } from "@/lib/api/metrics.service"
import { BodyMetric } from "@/lib/types/api.types"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { isAuthError, isNetworkError } from "@/lib/api/error.handler"

type MetricTab = 'weight' | 'composition' | 'measurements'

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<BodyMetric[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddSheet, setShowAddSheet] = useState(false)
  const [initialTab, setInitialTab] = useState<MetricTab>('weight')

  const fetchMetrics = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await metricsService.getUserMetrics(50, 0)
      setMetrics(data)
    } catch (err) {
      if (isAuthError(err)) {
        setError("Tu sesión expiró. Iniciá sesión de nuevo.")
      } else if (isNetworkError(err)) {
        setError("Estás sin conexión. Revisá tu internet e intentá de nuevo.")
      } else {
        setError("No pudimos cargar los datos. Intentá de nuevo en un momento.")
      }
      console.error("Error fetching metrics:", err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchMetrics()
  }, [])

  const lastMetric = metrics[0] || null
  const weightTrend = metricsService.calculateWeightTrend(metrics)

  const openSheet = (tab: MetricTab) => {
    setInitialTab(tab)
    setShowAddSheet(true)
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-8 px-1">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-accent">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Métricas</h1>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-widest">Seguimiento Corporal</p>
          </div>
        </div>
      </div>

      {error && !isLoading ? (
        <ErrorState description={error} onRetry={fetchMetrics} />
      ) : (
        <div className="lg:grid lg:grid-cols-[300px_1fr] lg:gap-8 lg:items-start">
          <div className="lg:sticky lg:top-8 lg:space-y-4">
            {/* Weight Trend Card */}
            {lastMetric && (
              <div className="bg-card rounded-[2rem] p-6 mb-8 lg:mb-0 border border-border shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-6 pointer-events-none">
                  <Scale className="h-24 w-24 text-foreground/5" />
                </div>

                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Peso Actual</span>
                  <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    {format(new Date(lastMetric.createdAt), "d 'de' MMMM", { locale: es })}
                  </span>
                </div>

                <div className="flex items-baseline gap-3 mb-6">
                  <h2 className="font-display text-5xl font-semibold text-foreground tabular-nums-data tracking-tight">
                    {lastMetric.weightKg || '--'} <span className="text-xl text-muted-foreground">kg</span>
                  </h2>
                  {weightTrend !== null && (
                    <div className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-tighter",
                      weightTrend < 0 ? "bg-success/10 text-success" :
                      weightTrend > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                    )}>
                      {weightTrend < 0 ? <TrendingDown className="h-3 w-3" /> :
                       weightTrend > 0 ? <TrendingUp className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                      {Math.abs(weightTrend).toFixed(1)} kg
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-black/20 rounded-2xl p-3 border border-border cursor-pointer hover:bg-black/30 transition-colors" onClick={() => openSheet('composition')}>
                    <p className="text-[8px] font-semibold uppercase text-muted-foreground tracking-widest mb-1">Músculo</p>
                    <p className="text-foreground font-bold">{lastMetric.muscleMassKg ? `${lastMetric.muscleMassKg} kg` : '--'}</p>
                  </div>
                  <div className="bg-black/20 rounded-2xl p-3 border border-border cursor-pointer hover:bg-black/30 transition-colors" onClick={() => openSheet('composition')}>
                    <p className="text-[8px] font-semibold uppercase text-muted-foreground tracking-widest mb-1">Grasa</p>
                    <p className="text-foreground font-bold">{lastMetric.fatMassKg ? `${lastMetric.fatMassKg} kg` : '--'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Section Links */}
            <div className="space-y-4 mb-8 lg:mb-0">
              <MetricLink
                icon={Scale}
                title="Peso Corporal"
                value={lastMetric?.weightKg ? `${lastMetric.weightKg} kg` : "Sin datos"}
                color="text-primary"
                onClick={() => openSheet('weight')}
              />
              <MetricLink
                icon={Activity}
                title="Composición"
                value={lastMetric?.muscleMassKg ? `${lastMetric.muscleMassKg}kg M / ${lastMetric.fatMassKg}kg G` : "Sin datos"}
                color="text-success"
                onClick={() => openSheet('composition')}
              />
              <MetricLink
                icon={Ruler}
                title="Últimas Medidas"
                value={lastMetric?.waistCm ? `Cintura: ${lastMetric.waistCm} cm` : "Sin registros"}
                color="text-chart-4"
                onClick={() => openSheet('measurements')}
              />
            </div>
          </div>

          {/* History List */}
          <div className="px-1">
            <div className="flex items-center gap-2 mb-4">
              <History className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-foreground font-bold text-sm uppercase tracking-wider">Historial</h3>
            </div>

            {isLoading ? (
              <div className="py-12 flex flex-col items-center opacity-30">
                <div className="h-8 w-8 rounded-full border-2 border-t-primary border-border animate-spin mb-4" />
                <p className="text-xs font-bold uppercase tracking-widest text-foreground">Sincronizando</p>
              </div>
            ) : metrics.length === 0 ? (
              <div className="bg-card rounded-3xl border border-dashed border-border">
                <EmptyState
                  icon={Scale}
                  title="No hay registros todavía"
                  description="Registrá tu primera medición para empezar a ver tu evolución"
                  actionLabel="Registrar medición"
                  onAction={() => openSheet('weight')}
                />
              </div>
            ) : (
              <div className="space-y-3">
                {metrics.map((m) => (
                  <div key={m.id} className="bg-card border border-border rounded-2xl p-4 flex items-center justify-between hover:bg-accent transition-all">
                    <div>
                      <p className="font-display text-sm font-semibold text-foreground tabular-nums-data tracking-tight">{m.weightKg ? `${m.weightKg} kg` : 'Medidas'}</p>
                      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mt-0.5">
                        {format(new Date(m.createdAt), "d 'de' MMMM, yyyy", { locale: es })}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <AddMetricSheet
        open={showAddSheet}
        onClose={() => setShowAddSheet(false)}
        onSaved={fetchMetrics}
        initialTab={initialTab}
      />
    </>
  )
}

function MetricLink({ icon: Icon, title, value, color, onClick }: { icon: any, title: string, value: string, color: string, onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="bg-card border border-border rounded-2xl p-4 flex items-center gap-4 cursor-pointer hover:bg-accent hover:border-primary/30 transition-all group"
    >
      <div className={cn("h-12 w-12 rounded-xl bg-white/5 flex items-center justify-center transition-all group-hover:scale-110", color)}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="flex-1">
        <h4 className="text-muted-foreground text-xs font-semibold uppercase tracking-widest">{title}</h4>
        <p className="text-foreground font-bold tracking-tight">{value}</p>
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
    </div>
  )
}
