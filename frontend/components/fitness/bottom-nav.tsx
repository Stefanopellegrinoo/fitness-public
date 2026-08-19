"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { navItems, isActiveRoute } from "@/components/fitness/nav-items"

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Navegación principal" className="fixed bottom-6 left-0 right-0 z-50 safe-area-bottom lg:hidden">
      <div className="max-w-lg mx-auto px-4 pb-2">
        <div className="flex items-center justify-around bg-card/95 backdrop-blur-xl px-2 py-2 rounded-2xl shadow-2xl shadow-black/50 border border-border">
          {navItems.map((item) => {
            const isActive = isActiveRoute(pathname, item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-200 min-w-[48px]",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground active:text-foreground"
                )}
              >
                <item.icon aria-hidden="true" className={cn("h-5 w-5", isActive && "scale-110")} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
