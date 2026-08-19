"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth/auth.context"
import { navItems, isActiveRoute } from "@/components/fitness/nav-items"

export function Sidebar() {
  const pathname = usePathname()
  const { user } = useAuth()

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 sticky top-0 h-dvh border-r border-border bg-card/40">
      <div className="px-5 py-6">
        <span className="font-display text-xl font-semibold tracking-tight text-foreground">
          FITNESS
        </span>
      </div>

      <nav aria-label="Navegación principal" className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = isActiveRoute(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              )}
            >
              <item.icon aria-hidden="true" className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {user?.email && (
        <div className="px-5 py-4 border-t border-border">
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        </div>
      )}
    </aside>
  )
}
