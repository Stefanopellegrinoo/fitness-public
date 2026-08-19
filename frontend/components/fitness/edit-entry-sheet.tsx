"use client"

import { useState, useEffect } from "react"
import { X, Flame, Weight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { MacroCompact } from "@/components/fitness/food-sheet-parts"
import { nutritionService } from "@/lib/api/nutrition.service"
import { entryUnit } from "@/lib/nutrition/entryUnit"
import { NutritionEntry } from "@/lib/types/api.types"
import { toast } from "sonner"

type MealCategory = NutritionEntry['mealCategory']

/**
 * Change the amount, or the meal, of something already in the diary.
 *
 * The macros ALWAYS travel with the request. The backend only recomputes them
 * when the entry has a foodItem behind it (nutrition.routes.ts:236), and an
 * entry without one is the common case — every recipe by design, and every
 * custom food not saved to the catalog. Leaving it to the backend would halve
 * an entry's grams and keep its calories.
 *
 * They are scaled from the entry's OWN stored snapshot rather than recomputed
 * from the catalog, which is both simpler and more correct: the snapshot is what
 * the user actually ate, and it stays right even if the FoodItem was edited
 * afterwards.
 */
function scaleMacros(entry: NutritionEntry, grams: number) {
  // A stored amount of zero has no ratio to scale by. The backend forbids it
  // (grams is z.number().positive()), so this only guards legacy rows.
  const ratio = entry.grams > 0 ? grams / entry.grams : 1
  return {
    calories: entry.calories * ratio,
    protein: entry.protein * ratio,
    carbs: entry.carbs * ratio,
    fat: entry.fat * ratio,
  }
}

export function EditEntrySheet({
  open,
  entry,
  onClose,
  onSaved,
}: {
  open: boolean
  entry: NutritionEntry | null
  onClose: () => void
  onSaved: () => void
}) {
  const [amount, setAmount] = useState("")
  const [mealCategory, setMealCategory] = useState<MealCategory>('Desayuno')
  const [isSaving, setIsSaving] = useState(false)

  // Keyed on the entry id: reopening on another row must not keep the previous
  // row's numbers.
  useEffect(() => {
    if (!entry) return
    setAmount(String(entry.grams))
    setMealCategory(entry.mealCategory)
  }, [entry?.id, entry])

  if (!entry) return null

  const numAmount = parseFloat(amount)
  const isValidAmount = Number.isFinite(numAmount) && numAmount > 0
  const macros = scaleMacros(entry, isValidAmount ? numAmount : entry.grams)
  const unit = entryUnit(entry)

  const handleSave = async () => {
    if (!isValidAmount) return
    setIsSaving(true)
    try {
      await nutritionService.updateNutritionEntry(entry.id, {
        grams: numAmount,
        mealCategory,
        ...scaleMacros(entry, numAmount),
      })
      toast.success("Registro actualizado")
      onSaved()
      onClose()
    } catch (err) {
      console.error("Error updating nutrition entry:", err)
      toast.error("No pudimos actualizar el registro. Intentá de nuevo.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent
        side="bottom"
        className="bg-background border-t border-border rounded-t-[2.5rem] overflow-hidden flex flex-col focus:outline-none"
      >
        <SheetHeader className="flex flex-row items-center justify-between pb-4 px-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-9 w-9 rounded-xl bg-white/5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
            <SheetTitle className="text-foreground text-lg font-bold tracking-tight leading-tight">
              Editar registro
            </SheetTitle>
          </div>
        </SheetHeader>

        <div className="flex-1 flex flex-col px-4 overflow-y-auto pb-6">
          <div className="bg-card border border-border rounded-3xl p-4 mb-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Flame className="h-5 w-5 text-primary" />
              </div>
              <h4 className="text-foreground font-bold text-lg tracking-tight truncate flex-1 min-w-0">
                {entry.foodName}
              </h4>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              <MacroCompact value={String(macros.calories)} label="kcal" color="text-foreground" />
              <MacroCompact value={String(macros.protein)} label="P" color="text-destructive" />
              <MacroCompact value={String(macros.carbs)} label="C" color="text-chart-5" />
              <MacroCompact value={String(macros.fat)} label="G" color="text-primary" />
            </div>
          </div>

          <div className="space-y-4 px-1">
            <div className="flex items-center gap-3 bg-card p-3 rounded-2xl border border-border">
              <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center text-muted-foreground">
                <Weight className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-[9px] font-semibold uppercase text-muted-foreground tracking-widest mb-0.5">
                  Cantidad
                </p>
                <div className="flex items-center">
                  <Input
                    type="number"
                    aria-label="Cantidad"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-7 bg-transparent border-none text-foreground p-0 text-xl font-semibold focus-visible:ring-0"
                  />
                  <span className="text-primary font-bold text-xs uppercase ml-2">{unit}</span>
                </div>
              </div>
            </div>

            <select
              aria-label="Comida"
              value={mealCategory}
              onChange={(e) => setMealCategory(e.target.value as MealCategory)}
              className="w-full h-11 px-3 rounded-xl bg-card border border-border text-foreground text-xs font-bold appearance-none focus:outline-none"
            >
              <option value="Desayuno">Desayuno</option>
              <option value="Almuerzo">Almuerzo</option>
              <option value="Merienda">Merienda</option>
              <option value="Cena">Cena</option>
              <option value="Snacks">Snack</option>
            </select>

            {!isValidAmount && (
              <p className="text-[11px] text-chart-5 px-1">
                La cantidad tiene que ser mayor que cero.
              </p>
            )}

            <Button
              onClick={handleSave}
              disabled={!isValidAmount || isSaving}
              className="w-full h-14 text-sm font-semibold uppercase tracking-widest shadow-xl shadow-primary/20"
            >
              {isSaving ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
