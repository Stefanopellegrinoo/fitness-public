import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ErrorStateProps {
  title?: string
  description: string
  onRetry?: () => void
}

// Shared error-state layout for fetch-on-mount failures: cause (description)
// + recovery (Reintentar). Never pass raw error/err.message here — curate a
// Spanish, actionable description at the call site and log the raw error via
// console.error instead.
export function ErrorState({ title = "Algo salió mal", description, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 px-6 text-center">
      <div className="bg-destructive/10 rounded-2xl p-4">
        <AlertTriangle className="text-destructive h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-foreground font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-sm text-center max-w-[28ch]">{description}</p>
      </div>
      {onRetry && (
        <Button variant="outline" className="mt-2" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  )
}
