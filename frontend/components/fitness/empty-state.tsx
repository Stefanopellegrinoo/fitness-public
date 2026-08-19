import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  actionHref?: string
}

// Shared empty-state layout: icon + title + optional description + optional
// action (button or link, depending on whether actionHref is provided).
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 px-6 text-center">
      <div className="bg-secondary rounded-2xl p-4">
        <Icon className="text-muted-foreground h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-foreground font-medium text-sm">{title}</p>
        {description && (
          <p className="text-muted-foreground text-sm text-center max-w-[28ch]">{description}</p>
        )}
      </div>
      {actionLabel && (
        actionHref ? (
          <Button asChild className="mt-2">
            <Link href={actionHref}>{actionLabel}</Link>
          </Button>
        ) : (
          <Button className="mt-2" onClick={onAction}>
            {actionLabel}
          </Button>
        )
      )}
    </div>
  )
}
