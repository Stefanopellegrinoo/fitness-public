'use client'

import { usePathname } from 'next/navigation'
import { BottomNav } from '@/components/fitness/bottom-nav'
import { Sidebar } from '@/components/fitness/sidebar'

const IMMERSIVE_ROUTES = ['/workout/active']

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const isImmersive = IMMERSIVE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )

  if (isImmersive) {
    return <>{children}</>
  }

  return (
    <div className="min-h-dvh bg-background lg:flex">
      <Sidebar />
      <div className="flex-1 min-w-0">
        <main className="mx-auto w-full max-w-lg lg:max-w-6xl px-4 lg:px-8 pt-6 lg:pt-8 pb-nav lg:pb-8 safe-area-top">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
