"use client"

import { useState, useEffect } from "react"
import { X, ArrowLeft, Plus, Trash2, ChefHat, AlertTriangle, Search, ScanLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { BrowseSpinner, MacroCompact } from "@/components/fitness/food-sheet-parts"
import { FoodSearchPanel, FoodScanPanel } from "@/components/fitness/food-picker"
import { recipeService } from "@/lib/api/recipe.service"
import { computeRecipeMacros } from "@/lib/nutrition/recipeMacros"
import { CreateRecipePayload, FoodItem, Recipe } from "@/lib/types/api.types"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

/**
 * Create and edit a recipe.
 *
 * Totals are previewed with the frontend mirror of the backend helper, but the
 * saved recipe always comes back derived from the server — the catalog stays the
 * single source of truth, and this never persists a macro it computed itself.
 */

/** A draft row. `key` is local and never sent; ids only exist server-side. */
interface DraftIngredient {
  key: string
  foodItem: FoodItem
  grams: string
}

type PickerMode = 'none' | 'search' | 'scan'

const DEFAULT_GRAMS = "100"

let keySeed = 0
function nextKey() {
  keySeed += 1
  return `draft-${keySeed}`
}

function toDraft(recipe: Recipe): DraftIngredient[] {
  return recipe.ingredients.map((ingredient) => ({
    key: nextKey(),
    grams: String(ingredient.grams),
    foodItem: {
      id: ingredient.foodItemId,
      name: ingredient.foodItem.name,
      brand: ingredient.foodItem.brand ?? undefined,
      caloriesPer100g: ingredient.foodItem.caloriesPer100g ?? undefined,
      proteinPer100g: ingredient.foodItem.proteinPer100g ?? undefined,
      carbsPer100g: ingredient.foodItem.carbsPer100g ?? undefined,
      fatPer100g: ingredient.foodItem.fatPer100g ?? undefined,
      isGramBased: true,
    },
  }))
}

export function RecipeEditorSheet({
  open,
  recipeId,
  onClose,
  onSaved,
}: {
  open: boolean
  /** null creates a new recipe; an id loads that one for editing. */
  recipeId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState("")
  const [servings, setServings] = useState("1")
  const [ingredients, setIngredients] = useState<DraftIngredient[]>([])
  const [pickerMode, setPickerMode] = useState<PickerMode>('none')
  const [isLoading, setIsLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const isEditing = recipeId !== null

  useEffect(() => {
    if (!open) return
    if (!recipeId) {
      setName("")
      setServings("1")
      setIngredients([])
      setLoadFailed(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setLoadFailed(false)
    recipeService
      .getRecipe(recipeId)
      .then((recipe) => {
        if (cancelled) return
        setName(recipe.name)
        setServings(String(recipe.servings))
        setIngredients(toDraft(recipe))
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, recipeId])

  const parsedServings = parseInt(servings, 10)
  const nutrition = computeRecipeMacros(
    ingredients.map((i) => ({ grams: parseFloat(i.grams) || 0, foodItem: i.foodItem })),
    parsedServings
  )

  // Mirrors what the backend would reject anyway (name 1-120, servings 1-100,
  // 1-50 ingredients, positive grams) so the user finds out before the round trip.
  const trimmedName = name.trim()
  const hasValidServings = Number.isInteger(parsedServings) && parsedServings >= 1 && parsedServings <= 100
  const hasValidGrams = ingredients.every((i) => (parseFloat(i.grams) || 0) > 0)
  const canSave =
    trimmedName.length > 0 &&
    trimmedName.length <= 120 &&
    hasValidServings &&
    ingredients.length > 0 &&
    ingredients.length <= 50 &&
    hasValidGrams &&
    !isSaving

  const addIngredient = (food: FoodItem) => {
    setIngredients((prev) => [...prev, { key: nextKey(), foodItem: food, grams: DEFAULT_GRAMS }])
    setPickerMode('none')
  }

  const removeIngredient = (key: string) => {
    setIngredients((prev) => prev.filter((i) => i.key !== key))
  }

  const setGrams = (key: string, grams: string) => {
    setIngredients((prev) => prev.map((i) => (i.key === key ? { ...i, grams } : i)))
  }

  const handleSave = async () => {
    if (!canSave) return
    setIsSaving(true)
    try {
      const payload: CreateRecipePayload = {
        name: trimmedName,
        servings: parsedServings,
        ingredients: ingredients.map((i) => ({
          foodItemId: i.foodItem.id,
          grams: parseFloat(i.grams) || 0,
        })),
      }

      if (recipeId) {
        await recipeService.updateRecipe(recipeId, payload)
      } else {
        await recipeService.createRecipe(payload)
      }
      onSaved()
      onClose()
    } catch (error) {
      console.error("Error saving recipe:", error)
      toast.error("No pudimos guardar la receta. Intentá de nuevo.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!recipeId) return
    setIsDeleting(true)
    try {
      await recipeService.deleteRecipe(recipeId)
      onSaved()
      onClose()
    } catch (error) {
      console.error("Error deleting recipe:", error)
      toast.error("No pudimos borrar la receta. Intentá de nuevo.")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent
        side="bottom"
        className="bg-background border-t border-border rounded-t-[2.5rem] h-[85vh] overflow-hidden flex flex-col focus:outline-none"
      >
        <SheetHeader className="flex flex-row items-center justify-between pb-4 px-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => (pickerMode === 'none' ? onClose() : setPickerMode('none'))}
              className="h-9 w-9 rounded-xl bg-white/5 text-muted-foreground hover:text-foreground"
            >
              {pickerMode === 'none' ? <X className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
            </Button>
            <SheetTitle className="text-foreground text-lg font-bold tracking-tight leading-tight">
              {pickerMode !== 'none'
                ? "Agregar ingrediente"
                : isEditing ? "Editar receta" : "Nueva receta"}
            </SheetTitle>
          </div>
        </SheetHeader>

        {isLoading ? (
          <BrowseSpinner />
        ) : loadFailed ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <AlertTriangle className="h-10 w-10 mb-2 text-chart-5" />
            <p className="text-xs font-bold uppercase tracking-[0.2em]">No pudimos cargar la receta</p>
          </div>
        ) : pickerMode !== 'none' ? (
          <div className="flex-1 flex flex-col px-4 overflow-hidden pb-6">
            <div className="flex bg-card rounded-xl p-1 border border-border mb-4">
              <button
                type="button"
                aria-pressed={pickerMode === 'search'}
                onClick={() => setPickerMode('search')}
                className={cn(
                  "flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-all flex items-center justify-center gap-2",
                  pickerMode === 'search' ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground"
                )}
              >
                <Search className="h-3.5 w-3.5" />
                Buscar
              </button>
              <button
                type="button"
                aria-pressed={pickerMode === 'scan'}
                onClick={() => setPickerMode('scan')}
                className={cn(
                  "flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-all flex items-center justify-center gap-2",
                  pickerMode === 'scan' ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground"
                )}
              >
                <ScanLine className="h-3.5 w-3.5" />
                Escanear
              </button>
            </div>

            {pickerMode === 'search' ? (
              <FoodSearchPanel onPick={addIngredient} placeholder="Buscar ingrediente..." />
            ) : (
              <FoodScanPanel
                active
                onPick={addIngredient}
                onFallbackToSearch={() => setPickerMode('search')}
              />
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col px-4 overflow-y-auto pb-6">
            <div className="bg-card border border-border rounded-3xl p-4 mb-4 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
                  <ChefHat className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <Input
                    aria-label="Nombre de la receta"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nombre de la receta..."
                    className="h-8 bg-transparent border-none text-foreground text-lg font-bold p-0 placeholder:text-white/20 focus-visible:ring-0"
                  />
                </div>
              </div>

              {nutrition.hasIncompleteMacros && (
                <div className="mb-3">
                  <span className="inline-flex items-center gap-1 rounded-lg bg-chart-5/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-chart-5">
                    <AlertTriangle className="h-3 w-3" />
                    Datos incompletos
                  </span>
                </div>
              )}

              <div className="grid grid-cols-4 gap-1.5">
                <MacroCompact value={String(nutrition.perServing.calories)} label="kcal/porc" color="text-foreground" />
                <MacroCompact value={String(nutrition.perServing.protein)} label="P" color="text-destructive" />
                <MacroCompact value={String(nutrition.perServing.carbs)} label="C" color="text-chart-5" />
                <MacroCompact value={String(nutrition.perServing.fat)} label="G" color="text-primary" />
              </div>

              <p className="text-[11px] text-muted-foreground mt-3 text-center">
                {Math.round(nutrition.totalGrams)} g en total · {Math.round(nutrition.gramsPerServing)} g por porción
              </p>
            </div>

            <div className="flex items-center gap-3 bg-card p-3 rounded-2xl border border-border mb-4">
              <div className="flex-1">
                <p className="text-[9px] font-semibold uppercase text-muted-foreground tracking-widest mb-0.5">Rinde</p>
                <div className="flex items-center">
                  <Input
                    type="number"
                    aria-label="Rinde"
                    value={servings}
                    onChange={(e) => setServings(e.target.value)}
                    className="h-7 bg-transparent border-none text-foreground p-0 text-xl font-semibold focus-visible:ring-0"
                  />
                  <span className="text-primary font-bold text-xs uppercase ml-2">porciones</span>
                </div>
              </div>
            </div>

            <div className="space-y-2 mb-4">
              {ingredients.length === 0 ? (
                <div className="text-center py-8 opacity-40">
                  <p className="text-xs font-bold uppercase tracking-[0.2em]">Sin ingredientes todavía</p>
                  <p className="text-[11px] text-muted-foreground mt-2 normal-case tracking-normal">
                    Una receta necesita al menos uno.
                  </p>
                </div>
              ) : (
                ingredients.map((ingredient) => (
                  <div
                    key={ingredient.key}
                    className="flex items-center gap-3 p-3 bg-card border border-border rounded-2xl"
                  >
                    <div className="flex-1 min-w-0">
                      <h4 className="text-foreground font-bold text-sm tracking-tight truncate">
                        {ingredient.foodItem.name}
                      </h4>
                      <p className="text-muted-foreground text-[10px] font-medium uppercase truncate">
                        {ingredient.foodItem.brand || "Genérico"}
                      </p>
                    </div>
                    <Input
                      type="number"
                      aria-label={`Gramos de ${ingredient.foodItem.name}`}
                      value={ingredient.grams}
                      onChange={(e) => setGrams(ingredient.key, e.target.value)}
                      className="h-9 w-20 bg-white/5 border-border text-foreground text-sm font-semibold text-right"
                    />
                    <span className="text-primary font-bold text-xs uppercase">g</span>
                    <button
                      type="button"
                      aria-label={`Quitar ${ingredient.foodItem.name}`}
                      onClick={() => removeIngredient(ingredient.key)}
                      className="h-9 w-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <Button
              variant="outline"
              onClick={() => setPickerMode('search')}
              className="h-12 border-dashed border-border bg-white/5 mb-4 flex items-center justify-center gap-3 text-primary hover:bg-primary/10 transition-all"
            >
              <Plus className="h-4 w-4" />
              <span className="font-semibold text-xs uppercase tracking-widest">Agregar Ingrediente</span>
            </Button>

            <div className="flex flex-col gap-3 mt-auto">
              <Button
                onClick={handleSave}
                disabled={!canSave}
                className="w-full h-14 text-sm font-semibold uppercase tracking-widest shadow-xl shadow-primary/20"
              >
                {isSaving ? "Guardando..." : isEditing ? "Guardar Cambios" : "Crear Receta"}
              </Button>

              {isEditing && (
                <Button
                  variant="ghost"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="w-full h-12 text-xs font-semibold uppercase tracking-widest text-destructive hover:bg-destructive/10"
                >
                  {isDeleting ? "Borrando..." : "Borrar Receta"}
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
