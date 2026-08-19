"use client"

import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"

interface DashboardHeaderProps {
  username: string
  onLogout?: () => void
}

export function DashboardHeader({ username, onLogout }: DashboardHeaderProps) {
  return (
    <header className="flex items-start justify-between mb-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Inicio</h1>
        <p className="text-muted-foreground mt-1">Hola, {username}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onLogout}
        className="bg-transparent border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <LogOut className="h-4 w-4 mr-2" />
        Salir
      </Button>
    </header>
  )
}
