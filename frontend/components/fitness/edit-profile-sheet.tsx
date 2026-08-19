"use client"

import { useState, useEffect } from "react"
import { X, User, Ruler, Weight, Target, Activity, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { userService, UserProfile } from "@/lib/api/user.service"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface EditProfileSheetProps {
  open: boolean
  onClose: () => void
  user: UserProfile | null
  onSaved: () => void
}

export function EditProfileSheet({ open, onClose, user, onSaved }: EditProfileSheetProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [formData, setFormData] = useState<any>({
    name: "",
    heightCm: "",
    currentWeightKg: "",
    goal: "MAINTENANCE",
    activityLevel: "MODERATE"
  })

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || "",
        heightCm: user.heightCm?.toString() || "",
        currentWeightKg: user.currentWeightKg?.toString() || "",
        goal: user.goal || "MAINTENANCE",
        activityLevel: user.activityLevel || "MODERATE"
      })
    }
  }, [user, open])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const payload = {
        name: formData.name,
        heightCm: parseFloat(formData.heightCm) || undefined,
        currentWeightKg: parseFloat(formData.currentWeightKg) || undefined,
        goal: formData.goal,
        activityLevel: formData.activityLevel
      }
      await userService.updateProfile(payload)
      toast.success("Perfil actualizado con éxito")
      onSaved()
      onClose()
    } catch (error) {
      console.error("Error updating profile:", error)
      toast.error("No pudimos actualizar tu perfil. Intentá de nuevo.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent
        side="bottom"
        className="bg-background border-t border-border rounded-t-[2.5rem] h-[85vh] overflow-hidden flex flex-col focus:outline-none px-4"
      >
        <SheetHeader className="pb-6 pt-2 px-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 rounded-xl bg-white/5 text-muted-foreground">
                <X className="h-4 w-4" />
              </Button>
              <SheetTitle className="text-foreground text-xl font-bold tracking-tight">Editar Perfil</SheetTitle>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto pb-10 space-y-6 px-2">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground ml-1">Nombre Completo</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary/50" />
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="h-14 pl-12 bg-card border-border text-foreground rounded-2xl font-bold focus:ring-primary/20"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground ml-1">Altura (cm)</label>
                <div className="relative">
                  <Ruler className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary/50" />
                  <Input
                    type="number"
                    value={formData.heightCm}
                    onChange={(e) => setFormData({ ...formData, heightCm: e.target.value })}
                    className="h-14 pl-12 bg-card border-border text-foreground rounded-2xl font-bold focus:ring-primary/20"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground ml-1">Peso Actual (kg)</label>
                <div className="relative">
                  <Weight className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary/50" />
                  <Input
                    type="number"
                    value={formData.currentWeightKg}
                    onChange={(e) => setFormData({ ...formData, currentWeightKg: e.target.value })}
                    className="h-14 pl-12 bg-card border-border text-foreground rounded-2xl font-bold focus:ring-primary/20"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Goals Selector */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground ml-1">Tu Objetivo Principal</label>
            <div className="grid grid-cols-3 gap-2">
              <SelectButton
                active={formData.goal === 'CUT'}
                label="Definir"
                onClick={() => setFormData({...formData, goal: 'CUT'})}
              />
              <SelectButton
                active={formData.goal === 'MAINTENANCE'}
                label="Mantener"
                onClick={() => setFormData({...formData, goal: 'MAINTENANCE'})}
              />
              <SelectButton
                active={formData.goal === 'BULK'}
                label="Volumen"
                onClick={() => setFormData({...formData, goal: 'BULK'})}
              />
            </div>
          </div>

          {/* Activity Level */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground ml-1">Nivel de Actividad</label>
            <div className="space-y-2">
              <ActivityOption
                active={formData.activityLevel === 'SEDENTARY'}
                title="Sedentario"
                sub="Poco o nada de ejercicio"
                onClick={() => setFormData({...formData, activityLevel: 'SEDENTARY'})}
              />
              <ActivityOption
                active={formData.activityLevel === 'MODERATE'}
                title="Moderado"
                sub="Ejercicio 3-5 días/semana"
                onClick={() => setFormData({...formData, activityLevel: 'MODERATE'})}
              />
              <ActivityOption
                active={formData.activityLevel === 'VERY_ACTIVE'}
                title="Muy Activo"
                sub="Entrenamiento intenso diario"
                onClick={() => setFormData({...formData, activityLevel: 'VERY_ACTIVE'})}
              />
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full h-16 text-lg font-semibold uppercase tracking-tighter shadow-2xl shadow-primary/20 mt-4"
          >
            {isSaving ? "Guardando..." : "Guardar Cambios"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function SelectButton({ active, label, onClick }: { active: boolean, label: string, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "py-3 rounded-xl border font-bold text-xs uppercase transition-all",
        active ? "bg-primary border-primary text-primary-foreground shadow-lg" : "bg-card border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  )
}

function ActivityOption({ active, title, sub, onClick }: { active: boolean, title: string, sub: string, onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "p-4 rounded-2xl border flex items-center justify-between cursor-pointer transition-all",
        active ? "bg-primary/10 border-primary/50" : "bg-card border-border hover:bg-accent"
      )}
    >
      <div>
        <p className={cn("font-bold text-sm", active ? "text-primary" : "text-foreground")}>{title}</p>
        <p className="text-xs text-muted-foreground font-medium">{sub}</p>
      </div>
      {active && <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_10px_color-mix(in_srgb,var(--primary)_50%,transparent)]" />}
    </div>
  )
}
