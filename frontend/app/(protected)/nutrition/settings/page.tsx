"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ArrowLeft, Save, Sparkles, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ErrorState } from "@/components/fitness/error-state"
import { nutritionService } from "@/lib/api/nutrition.service"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

export default function NutritionSettingsPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [goal, setGoal] = useState({
    kcal: 2000,
    proteinG: 150,
    carbsG: 200,
    fatG: 65,
  })

  const fetchGoal = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await nutritionService.getNutritionGoal()
      setGoal({
        kcal: data.kcal,
        proteinG: data.proteinG,
        carbsG: data.carbsG,
        fatG: data.fatG,
      })
    } catch (err) {
      setError("No pudimos cargar tus metas de nutrición. Revisá tu conexión e intentá de nuevo.")
      console.error("Error fetching goals:", err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchGoal()
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await nutritionService.setNutritionGoal(goal)
      toast.success("Metas actualizadas con éxito")
      router.push("/nutrition")
    } catch (err) {
      console.error("Error saving nutrition goal:", err)
      toast.error("No pudimos guardar tus metas. Intentá de nuevo.")
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">Cargando tus metas...</p>
      </div>
    )
  }

  if (error) {
    return <ErrorState description={error} onRetry={fetchGoal} />
  }

  return (
    <div className="lg:max-w-xl lg:mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link href="/nutrition">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Metas de Nutrición</h1>
          <p className="text-muted-foreground text-sm">Ajusta tus requerimientos diarios</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Main Card */}
        <div className="bg-card border border-border rounded-3xl p-6 shadow-xl shadow-black/40 overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <Target className="h-24 w-24 text-primary" />
          </div>

          <div className="space-y-6 relative z-10">
            <div>
              <label className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase tracking-widest mb-3 px-1">
                Calorías Diarias (kcal)
              </label>
              <div className="relative">
                <Input
                  type="number"
                  value={goal.kcal}
                  onChange={(e) => setGoal({ ...goal, kcal: parseFloat(e.target.value) || 0 })}
                  className="h-14 bg-black/40 border-border text-foreground text-xl font-bold rounded-2xl focus:ring-primary/50 focus:border-primary"
                />
                <Sparkles className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary/30" />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <MacroInput
                label="Proteína (g)"
                value={goal.proteinG}
                onChange={(val) => setGoal({ ...goal, proteinG: val })}
                color="text-destructive"
                icon="P"
              />
              <MacroInput
                label="Carbohidratos (g)"
                value={goal.carbsG}
                onChange={(val) => setGoal({ ...goal, carbsG: val })}
                color="text-chart-5"
                icon="C"
              />
              <MacroInput
                label="Grasas (g)"
                value={goal.fatG}
                onChange={(val) => setGoal({ ...goal, fatG: val })}
                color="text-primary"
                icon="G"
              />
            </div>
          </div>
        </div>

        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full py-8 text-lg font-semibold shadow-lg shadow-primary/20 transition-all hover:scale-[1.01] active:scale-[0.98]"
        >
          {isSaving ? "Guardando..." : (
            <>
              <Save className="h-5 w-5 mr-2" />
              Guardar Configuración
            </>
          )}
        </Button>
      </div>

      <div className="mt-8 p-5 bg-primary/5 border border-primary/10 rounded-2xl">
        <p className="text-primary/80 text-xs leading-relaxed text-center">
          "Tu nutrición es la base de tus resultados. Ajustá estos valores de acuerdo a tu plan de entrenamiento y metabolismo."
        </p>
      </div>
    </div>
  )
}

function MacroInput({
  label,
  value,
  onChange,
  color,
  icon
}: {
  label: string,
  value: number,
  onChange: (val: number) => void,
  color: string,
  icon: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-muted-foreground text-[11px] font-bold uppercase tracking-widest px-1">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl bg-black/50 border border-border flex items-center justify-center font-bold text-xs ${color} shadow-inner`}>
          {icon}
        </div>
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="h-12 bg-black/40 border-border text-foreground font-semibold rounded-xl focus:ring-primary/20"
        />
      </div>
    </div>
  )
}
