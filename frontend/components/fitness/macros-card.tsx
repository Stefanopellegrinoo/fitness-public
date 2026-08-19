import { Utensils } from "lucide-react"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/fitness/empty-state"

interface MacrosData {
  calories?: { current: number; target: number }
  protein?: { current: number; target: number }
  carbs?: { current: number; target: number }
  fat?: { current: number; target: number }
}

interface MacrosCardProps {
  data?: MacrosData
}

export function MacrosCard({ data }: MacrosCardProps) {
  const hasData = data && (
    (data.calories?.current ?? 0) > 0 ||
    (data.protein?.current ?? 0) > 0 ||
    (data.carbs?.current ?? 0) > 0 ||
    (data.fat?.current ?? 0) > 0
  )

  return (
    <div className="bg-card rounded-2xl p-5 border border-border">
      <div className="flex items-center gap-2 mb-5">
        <Utensils className="h-5 w-5 text-primary" />
        <h3 className="text-foreground font-semibold">Distribución de macros</h3>
      </div>

      {hasData ? (
        <div className="space-y-4">
          {data?.calories && (
            <MacroRow
              label="Calorías"
              current={data.calories.current}
              target={data.calories.target}
              unit="kcal"
              fillColor="bg-primary"
              textColor="text-primary"
            />
          )}
          {data?.protein && (
            <MacroRow
              label="Proteína"
              current={data.protein.current}
              target={data.protein.target}
              unit="g"
              fillColor="bg-destructive"
              textColor="text-destructive"
            />
          )}
          {data?.carbs && (
            <MacroRow
              label="Carbohidratos"
              current={data.carbs.current}
              target={data.carbs.target}
              unit="g"
              fillColor="bg-chart-5"
              textColor="text-chart-5"
            />
          )}
          {data?.fat && (
            <MacroRow
              label="Grasas"
              current={data.fat.current}
              target={data.fat.target}
              unit="g"
              fillColor="bg-chart-2"
              textColor="text-chart-2"
            />
          )}
        </div>
      ) : (
        <EmptyState
          icon={Utensils}
          title="Todavía no registraste comidas"
          description="Cargá tu primera comida para ver tus macros del día"
          actionLabel="Registrar comida"
          actionHref="/nutrition"
        />
      )}
    </div>
  )
}

function MacroRow({
  label,
  current,
  target,
  unit,
  fillColor,
  textColor,
}: {
  label: string
  current: number
  target: number
  unit: string
  fillColor: string
  textColor: string
}) {
  const isOver = target > 0 && current > target
  const percentage = target > 0 ? Math.min((current / target) * 100, 100) : 0

  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-muted-foreground text-sm">{label}</span>
        <span className={cn("font-mono text-sm tabular-nums-data", isOver ? textColor : "text-foreground")}>
          {Math.round(current)} / {Math.round(target)} {unit}
        </span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-300", fillColor)}
          style={{ width: `${isOver ? 100 : percentage}%` }}
        />
      </div>
    </div>
  )
}
