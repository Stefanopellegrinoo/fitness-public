import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface MetricCardProps {
  icon: LucideIcon
  value: string | number
  label: string
  variant: "blue" | "orange" | "green" | "purple"
}

// "Gym plate" style: one flat surface for every card. `variant` now only
// picks the icon tint — orange ("energy") is reserved for the calories card,
// every other metric uses a neutral muted icon.
export function MetricCard({ icon: Icon, value, label, variant }: MetricCardProps) {
  const isEnergyAccent = variant === "orange"

  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="inline-flex p-2.5 rounded-xl bg-secondary w-fit">
        <Icon
          className={cn("h-5 w-5", isEnergyAccent ? "text-primary" : "text-muted-foreground")}
          strokeWidth={2}
        />
      </div>
      <div className="mt-3">
        <div className="font-display text-4xl font-semibold text-foreground tabular-nums-data tracking-tight">
          {value}
        </div>
        <div className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
          {label}
        </div>
      </div>
    </div>
  )
}
