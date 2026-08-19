"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Scale, Flame, Dumbbell, Timer } from "lucide-react"
import { DashboardHeader } from "@/components/fitness/dashboard-header"
import { MetricCard } from "@/components/fitness/metric-card"
import { MacrosCard } from "@/components/fitness/macros-card"
import { ErrorState } from "@/components/fitness/error-state"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/lib/auth/auth.context"
import { dashboardService } from "@/lib/api/dashboard.service"
import { nutritionService } from "@/lib/api/nutrition.service"
import {
  mapSummaryToMetrics,
  buildMacrosData,
  type DashboardMetrics,
  type MacrosData,
} from "@/lib/api/dashboard.mapper"
import { isAuthError, isNetworkError } from "@/lib/api/error.handler"

export default function DashboardPage() {
  const router = useRouter()
  const { user, logout, isLoading: authLoading } = useAuth()
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    currentWeight: "-",
    totalCalories: 0,
    workouts: 0,
    minutes: 0,
  })
  const [macros, setMacros] = useState<MacrosData | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const fetchMetrics = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const summary = await dashboardService.getSummary()
      setMetrics(mapSummaryToMetrics(summary))

      try {
        // One instant, reused for both the request range and the day the
        // entries are aggregated against. Two separate `new Date()` calls
        // here could straddle a midnight tick and disagree about which day
        // "today" is, leaving the request and the filter scoped to
        // different days — and the card would render as empty, not wrong.
        const now = new Date()
        const [entries, goal] = await Promise.all([
          nutritionService.getNutritionHistory(100, 0, nutritionService.dayBounds(now)),
          nutritionService.getNutritionGoal(),
        ])
        setMacros(buildMacrosData(entries, goal, now))
      } catch (nutritionErr) {
        // La card de macros muestra su estado vacío; el resto del dashboard no depende de esto
        console.error("Failed to fetch nutrition data for macros card:", nutritionErr)
      }
    } catch (err) {


      if (isAuthError(err)) {
        // In real app, redirect to login
        setError("Tu sesión expiró. Iniciá sesión de nuevo.")
      } else if (isNetworkError(err)) {
        setError("Estás sin conexión. Revisá tu internet e intentá de nuevo.")
      } else {
        setError("No pudimos cargar los datos. Intentá de nuevo en un momento.")
      }

      console.error("Failed to fetch dashboard metrics:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true)
      await logout()
      router.push('/login')
      router.refresh()
    } catch (error) {
      console.error('Logout failed:', error)
      setError('No se pudo cerrar sesión. Intentá de nuevo.')
      setIsLoggingOut(false)
    }
  }

  useEffect(() => {
    if (!authLoading) {
      fetchMetrics()
    }
  }, [authLoading])

  // Get username from user email or use a default
  const username = user?.email?.split('@')[0] || "atleta"

  return (
    <>
      <DashboardHeader
        username={username}
        onLogout={handleLogout}
      />

      {/* Loading State */}
      {(authLoading || isLoading) && (
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <Spinner className="w-8 h-8" />
          <p className="text-sm text-muted-foreground">Cargando tus métricas...</p>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && !authLoading && (
        <ErrorState description={error} onRetry={fetchMetrics} />
      )}

      {/* Metric Cards Grid - exactly like screenshot */}
      {!isLoading && !error && !authLoading && (
        <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">
          <div className="grid grid-cols-2 gap-3 mb-4 lg:mb-0 lg:gap-4">
            <MetricCard
              icon={Scale}
              value={metrics.currentWeight}
              label="Peso Actual"
              variant="blue"
            />
            <MetricCard
              icon={Flame}
              value={metrics.totalCalories}
              label="Calorías Hoy"
              variant="orange"
            />
            <MetricCard
              icon={Dumbbell}
              value={metrics.workouts}
              label="Entrenos"
              variant="green"
            />
            <MetricCard
              icon={Timer}
              value={metrics.minutes}
              label="Minutos"
              variant="purple"
            />
          </div>

          {/* Macros Distribution Card */}
          <MacrosCard data={macros} />
        </div>
      )}
    </>
  )
}
