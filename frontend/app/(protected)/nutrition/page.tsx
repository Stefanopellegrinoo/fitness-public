"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { ArrowLeft, Plus, ChevronLeft, ChevronRight, Utensils, Flame, Settings, Trash2, Calendar, Target, Zap, Droplets, Scale } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AddFoodSheet } from "@/components/fitness/add-food-sheet"
import { EditEntrySheet } from "@/components/fitness/edit-entry-sheet"
import { ErrorState } from "@/components/fitness/error-state"
import { entryUnit } from "@/lib/nutrition/entryUnit"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { nutritionService } from "@/lib/api/nutrition.service"
import { NutritionEntry, NutritionGoal, CreateNutritionEntryPayload } from "@/lib/types/api.types"
import { format, isToday } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { isAuthError, isNetworkError } from "@/lib/api/error.handler"

const MEAL_CATEGORIES = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Snacks'] as const;

export default function NutritionPage() {
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [entries, setEntries] = useState<NutritionEntry[]>([])
  const [goal, setGoal] = useState<NutritionGoal | null>(null)
  const [showAddFood, setShowAddFood] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<NutritionEntry | null>(null)
  const [editingEntry, setEditingEntry] = useState<NutritionEntry | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async (date: Date) => {
    setIsLoading(true)
    setError(null)
    try {
      // Scoped to the selected day server-side. It used to fetch the last 100
      // entries and filter them here, which meant that past roughly 37 days of
      // use — measured at 2.7 entries a day — older days fell off the window and
      // rendered as empty, indistinguishable from a day with nothing logged.
      const [history, userGoal] = await Promise.all([
        nutritionService.getNutritionHistory(100, 0, nutritionService.dayBounds(date)),
        nutritionService.getNutritionGoal()
      ])

      setEntries(history)
      setGoal(userGoal)
    } catch (err) {
      if (isAuthError(err)) {
        setError("Tu sesión expiró. Iniciá sesión de nuevo.")
      } else if (isNetworkError(err)) {
        setError("Estás sin conexión. Revisá tu internet e intentá de nuevo.")
      } else {
        setError("No pudimos cargar los datos. Intentá de nuevo en un momento.")
      }
      console.error("Error fetching nutrition data:", err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData(selectedDate)
  }, [selectedDate])

  const navigateDate = (days: number) => {
    const newDate = new Date(selectedDate)
    newDate.setDate(newDate.getDate() + days)
    setSelectedDate(newDate)
  }

  const groupedEntries = useMemo(() => {
    const groups: Record<string, NutritionEntry[]> = {}
    MEAL_CATEGORIES.forEach(cat => groups[cat] = [])
    entries.forEach(entry => {
      if (groups[entry.mealCategory]) {
        groups[entry.mealCategory].push(entry)
      }
    })
    return groups
  }, [entries])

  const totals = useMemo(() => nutritionService.calculateDailyTotals(entries), [entries])

  const handleAddEntry = async (payload: CreateNutritionEntryPayload) => {
    try {
      // The same bounds the diary reads this day back with. Sending them makes
      // the backend merge inside the day the user is looking at instead of the
      // one the server's own clock would compute, which for a Buenos Aires user
      // near midnight is a different day.
      const { from, to } = nutritionService.dayBounds(selectedDate)
      const entryWithDate = {
        ...payload,
        date: selectedDate.toISOString(),
        mergeFrom: from,
        mergeTo: to,
      }
      await nutritionService.addNutritionEntry(entryWithDate)
      toast.success("Alimento agregado")
      fetchData(selectedDate)
    } catch (err) {
      console.error("Error adding nutrition entry:", err)
      toast.error("No pudimos agregar el alimento. Intentá de nuevo.")
    }
  }

  // The row is only dropped once the server confirms: removing it first and
  // putting it back on failure would make the diary disagree with what is
  // actually stored for as long as the request is in flight.
  const handleDeleteEntry = async (id: string) => {
    setIsDeleting(true)
    try {
      await nutritionService.deleteNutritionEntry(id)
      toast.success("Alimento eliminado")
      setEntries(prev => prev.filter(e => e.id !== id))
      setPendingDelete(null)
    } catch (err) {
      console.error("Error deleting nutrition entry:", err)
      toast.error("No pudimos eliminar el registro. Intentá de nuevo.")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      {/* Header - Coherent with WorkoutPage */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-accent">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Nutrición</h1>
            <p className="text-muted-foreground text-sm">
              {isToday(selectedDate) ? "Hoy, " : ""}
              {format(selectedDate, "d 'de' MMMM", { locale: es })}
            </p>
          </div>
        </div>
        <Link href="/nutrition/settings">
          <Button size="sm" variant="outline" className="border-primary/40 text-primary hover:bg-primary/10">
            <Settings className="h-4 w-4 mr-1" />
            Metas
          </Button>
        </Link>
      </div>

      <div className="lg:grid lg:grid-cols-[300px_1fr] lg:gap-8 lg:items-start">
        <div className="lg:sticky lg:top-8 lg:space-y-4">
          {/* Date Navigator - Clean & Coherent */}
          <div className="flex items-center justify-between bg-card rounded-2xl p-3 mb-6 lg:mb-0 border border-border">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigateDate(-1)}
              aria-label="Día anterior"
              className="text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="text-foreground font-semibold text-sm uppercase tracking-wider">
              {format(selectedDate, "EEEE d", { locale: es })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigateDate(1)}
              aria-label="Día siguiente"
              className="text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          {/* Premium Progress Card - Matching Workout Style */}
          <div className="bg-card rounded-[2rem] p-6 mb-6 lg:mb-0 shadow-xl border border-border">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2 text-primary">
                <Flame className="h-5 w-5" />
                <h3 className="font-bold uppercase tracking-widest text-xs">Energía Diaria</h3>
              </div>
              <div className="text-right">
                <p className="font-display text-2xl font-semibold text-foreground tabular-nums-data tracking-tight">
                  {Math.round(totals.calories)} <span className="text-primary/50 text-sm">/ {goal?.kcal || 2000}</span>
                </p>
                <p className="text-muted-foreground text-xs font-bold uppercase tracking-tighter">KCAL CONSUMIDAS</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <MacroCircle label="Prote" value={totals.protein} target={goal?.proteinG || 150} color="text-destructive" bgColor="bg-destructive/10" />
              <MacroCircle label="Carbs" value={totals.carbs} target={goal?.carbsG || 200} color="text-chart-5" bgColor="bg-chart-5/10" />
              <MacroCircle label="Grasas" value={totals.fat} target={goal?.fatG || 65} color="text-primary" bgColor="bg-primary/10" />
            </div>
          </div>

          {/* Add Button - Coherent with WorkoutPage Action Style */}
          <Button
            onClick={() => setShowAddFood(true)}
            className="w-full h-14 text-base font-semibold mb-8 lg:mb-0 shadow-lg shadow-primary/20 transition-all"
          >
            <Plus className="h-5 w-5 mr-2 stroke-[2.5px]" />
            Registrar Alimento
          </Button>
        </div>

        {/* Meals Section - Clean & Styled */}
        <div className="space-y-6">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center opacity-30">
              <div className="h-8 w-8 rounded-full border-2 border-t-primary border-border animate-spin mb-4" />
              <p className="text-xs font-bold uppercase tracking-widest text-foreground">Cargando Nutrición</p>
            </div>
          ) : error ? (
            <ErrorState description={error} onRetry={() => fetchData(selectedDate)} />
          ) : MEAL_CATEGORIES.map(category => (
            <div key={category}>
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-foreground font-bold text-sm uppercase tracking-wider">{category}</h3>
                <span className="text-[10px] font-bold text-muted-foreground bg-white/5 px-2 py-0.5 rounded-full">
                  {Math.round(groupedEntries[category].reduce((sum, e) => sum + (e.calories || 0), 0))} KCAL
                </span>
              </div>

              {groupedEntries[category].length === 0 ? (
                <div
                  onClick={() => setShowAddFood(true)}
                  className="bg-card/40 border border-dashed border-border rounded-2xl p-4 flex items-center justify-center cursor-pointer hover:bg-card/60 transition-colors"
                >
                  <p className="text-muted-foreground text-xs font-medium">Sin registros en {category.toLowerCase()}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {groupedEntries[category].map((entry) => (
                    <div
                      key={entry.id}
                      className="group flex items-center justify-between p-4 bg-card border border-border rounded-2xl hover:border-primary/30 transition-all"
                    >
                      {/*
                        A button around the information, not around the whole
                        row: the delete control lives in here too, and nesting it
                        inside the tappable area would open the editor on every
                        attempt to delete.
                      */}
                      <button
                        type="button"
                        onClick={() => setEditingEntry(entry)}
                        aria-label={`Editar ${entry.foodName}`}
                        className="flex-1 min-w-0 text-left"
                      >
                        <span className="text-foreground font-semibold text-[15px] block truncate">{entry.foodName}</span>
                        <div className="flex gap-2.5 mt-1">
                          <span className="text-[10px] font-bold text-destructive/80">{Math.round(entry.protein)}P</span>
                          <span className="text-[10px] font-bold text-chart-5/80">{Math.round(entry.carbs)}C</span>
                          <span className="text-[10px] font-bold text-primary/80">{Math.round(entry.fat)}G</span>
                          <span className="text-[10px] font-medium text-muted-foreground uppercase ml-1">
                            {entry.grams}{entryUnit(entry) === 'g' ? 'g' : ' ud'}
                          </span>
                        </div>
                      </button>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-foreground font-bold text-[15px]">{Math.round(entry.calories)}</span>
                          <span className="text-muted-foreground text-[9px] block font-bold uppercase -mt-1">KCAL</span>
                        </div>
                        {/*
                          Always visible. It used to be `opacity-0
                          group-hover:opacity-100`, and there is no hover on a
                          touch screen — which is the only screen this app is
                          built for.
                        */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPendingDelete(entry)}
                          aria-label="Eliminar registro"
                          className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <AddFoodSheet
        open={showAddFood}
        onClose={() => setShowAddFood(false)}
        onAdd={handleAddEntry}
      />

      <EditEntrySheet
        open={editingEntry !== null}
        entry={editingEntry}
        onClose={() => setEditingEntry(null)}
        onSaved={() => fetchData(selectedDate)}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este registro?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `Se va a borrar "${pendingDelete.foodName}" de ${pendingDelete.mealCategory.toLowerCase()}. No se puede deshacer.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                // The dialog closes itself on action, which would unmount the
                // row before the request resolves and hide a failure.
                event.preventDefault()
                if (pendingDelete) handleDeleteEntry(pendingDelete.id)
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function MacroCircle({ label, value, target, color, bgColor }: { label: string, value: number, target: number, color: string, bgColor: string }) {
  const percentage = Math.min((value / target) * 100, 100)
  return (
    <div className={cn("rounded-2xl p-3 border border-border flex flex-col items-center", bgColor)}>
      <span className={cn("text-lg font-semibold tracking-tighter", color)}>{Math.round(value)}g</span>
      <span className="text-[8px] font-bold uppercase text-muted-foreground tracking-widest mt-0.5">{label}</span>
      <div className="w-full h-1 bg-black/40 rounded-full mt-2 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-1000", color.replace('text', 'bg'))}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
