"use client"

import { useState, useEffect } from "react"
import { ChefHat, AlertTriangle, Flame, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BrowseSpinner, MacroCompact } from "@/components/fitness/food-sheet-parts"
import { recipeService } from "@/lib/api/recipe.service"
import {
  CreateNutritionEntryPayload,
  MacroSet,
  RecipeListItem,
} from "@/lib/types/api.types"
import { cn } from "@/lib/utils"

type MealCategory = CreateNutritionEntryPayload['mealCategory']
type AmountMode = 'servings' | 'grams'

/**
 * Recipes are logged like any other food, but they are NOT FoodItems: a recipe
 * entry carries `foodItemId: undefined` and its macros already computed. That is
 * why this lives beside the food sheet instead of inside it — the food flow's
 * save path reads `selectedFood.id` into `foodItemId`, and a recipe uuid there
 * would be persisted straight into a FoodItem foreign key.
 */

/**
 * The single macro formula. Servings are converted to grams before it runs, so
 * the two modes cannot drift apart:
 *
 *   per100g x (n x gramsPerServing) / 100 == perServing x n
 */
function macrosForGrams(per100g: MacroSet, grams: number): MacroSet {
  const factor = grams / 100;
  return {
    calories: per100g.calories * factor,
    protein: per100g.protein * factor,
    carbs: per100g.carbs * factor,
    fat: per100g.fat * factor,
  };
}

function IncompleteBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-chart-5/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-chart-5">
      <AlertTriangle className="h-3 w-3" />
      Datos incompletos
    </span>
  )
}

export function RecipeTab({
  active,
  onSelect,
  onEdit,
  reloadToken = 0,
}: {
  active: boolean
  onSelect: (recipe: RecipeListItem) => void
  onEdit?: (recipe: RecipeListItem) => void
  /** Bumped by the caller after a save or a delete to force a re-fetch. */
  reloadToken?: number
}) {
  const [recipes, setRecipes] = useState<RecipeListItem[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [hasFailed, setHasFailed] = useState(false)

  // Fetched here rather than joining the sheet's Promise.all: that one rejects
  // as a whole, so a recipes failure would blank out Recientes and Favoritos.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    setIsLoading(true)
    setHasFailed(false)
    recipeService
      .getRecipes()
      .then((page) => {
        if (cancelled) return
        setRecipes(page.items)
        setTotal(page.total)
      })
      .catch(() => {
        if (!cancelled) setHasFailed(true)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active, reloadToken])

  if (isLoading) return <BrowseSpinner />

  if (hasFailed) {
    return (
      <div className="text-center py-12 opacity-60">
        <AlertTriangle className="h-10 w-10 mx-auto mb-2 text-chart-5" />
        <p className="text-xs font-bold uppercase tracking-[0.2em]">No pudimos cargar tus recetas</p>
        <p className="text-[11px] text-muted-foreground mt-2 normal-case tracking-normal">
          Volvé a entrar a esta pestaña para reintentar.
        </p>
      </div>
    )
  }

  if (recipes.length === 0) {
    return (
      <div className="text-center py-12 opacity-40">
        <ChefHat className="h-10 w-10 mx-auto mb-2" />
        <p className="text-xs font-bold uppercase tracking-[0.2em]">Todavía no tenés recetas</p>
        <p className="text-[11px] text-muted-foreground mt-2 normal-case tracking-normal">
          Una receta junta varios ingredientes en una sola comida.
        </p>
      </div>
    )
  }

  return (
    <>
      {recipes.map((recipe) => (
        <div
          key={recipe.id}
          className="flex items-center justify-between p-3 bg-card border border-border rounded-2xl hover:bg-accent transition-all"
        >
          {/* Tapping the row logs the recipe; only the pencil edits it. */}
          <button
            type="button"
            onClick={() => onSelect(recipe)}
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
          >
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <ChefHat className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-foreground font-bold text-sm tracking-tight truncate">{recipe.name}</h3>
              <p className="text-muted-foreground text-xs font-medium uppercase truncate">
                {recipe.ingredientCount} ingredientes · rinde {recipe.servings}
              </p>
              {recipe.nutrition.hasIncompleteMacros && (
                <div className="mt-1">
                  <IncompleteBadge />
                </div>
              )}
            </div>
          </button>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <div className="text-right">
              <p className="text-foreground font-bold text-xs">
                {Math.round(recipe.nutrition.perServing.calories)} kcal
              </p>
              <p className="text-muted-foreground text-[10px] font-medium uppercase">por porción</p>
            </div>
            {onEdit && (
              <button
                type="button"
                aria-label={`Editar ${recipe.name}`}
                onClick={() => onEdit(recipe)}
                className="h-9 w-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      ))}

      {total > recipes.length && (
        <p className="text-center text-[11px] text-muted-foreground pt-2">
          Mostrando {recipes.length} de un total de {total} recetas.
        </p>
      )}
    </>
  )
}

export function RecipeAmountStep({
  recipe,
  onAdd,
  onSaved,
}: {
  recipe: RecipeListItem
  onAdd: (entry: CreateNutritionEntryPayload) => Promise<void>
  onSaved: () => void
}) {
  const [mode, setMode] = useState<AmountMode>('servings')
  const [amount, setAmount] = useState('1')
  const [mealCategory, setMealCategory] = useState<MealCategory>('Desayuno')
  const [isSaving, setIsSaving] = useState(false)

  const { per100g, gramsPerServing } = recipe.nutrition
  const numAmount = parseFloat(amount) || 0
  const grams = mode === 'servings' ? numAmount * gramsPerServing : numAmount
  const macros = per100g ? macrosForGrams(per100g, grams) : null

  // Only reachable for a recipe with no weight at all: the helper returns a null
  // per100g rather than an Infinity, and there is nothing honest to log.
  const canLog = macros !== null

  /** Switching units keeps the same real amount of food, so the macros do not jump. */
  const switchMode = (next: AmountMode) => {
    if (next === mode) return
    if (gramsPerServing > 0) {
      const converted = next === 'grams' ? numAmount * gramsPerServing : numAmount / gramsPerServing
      setAmount(String(Number(converted.toFixed(2))))
    }
    setMode(next)
  }

  const handleSave = async () => {
    if (!macros) return
    setIsSaving(true)
    try {
      // No foodItemId on purpose: a recipe id is not a FoodItem id. The macros
      // travel with the entry, which is also what makes it a historical snapshot.
      await onAdd({
        foodName: recipe.name,
        grams,
        mealCategory,
        calories: macros.calories,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
      })
      onSaved()
    } catch {
      // The caller already surfaces the failure; keep the sheet open so the
      // user does not lose what they typed.
    } finally {
      setIsSaving(false)
    }
  }

  const shown = macros ?? { calories: 0, protein: 0, carbs: 0, fat: 0 }

  return (
    <div className="flex-1 flex flex-col px-4 overflow-y-auto pb-6">
      <div className="bg-card border border-border rounded-3xl p-4 mb-4 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Flame className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-foreground font-bold text-lg tracking-tight truncate">{recipe.name}</h4>
            {recipe.nutrition.hasIncompleteMacros && (
              <div className="mt-1">
                <IncompleteBadge />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          <MacroCompact value={String(shown.calories)} label="kcal" color="text-foreground" />
          <MacroCompact value={String(shown.protein)} label="P" color="text-destructive" />
          <MacroCompact value={String(shown.carbs)} label="C" color="text-chart-5" />
          <MacroCompact value={String(shown.fat)} label="G" color="text-primary" />
        </div>
      </div>

      <div className="space-y-4 px-1">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex bg-card rounded-xl p-1 border border-border">
            <button
              type="button"
              aria-pressed={mode === 'servings'}
              onClick={() => switchMode('servings')}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-all",
                mode === 'servings' ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground"
              )}
            >
              Porciones
            </button>
            <button
              type="button"
              aria-pressed={mode === 'grams'}
              onClick={() => switchMode('grams')}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-all",
                mode === 'grams' ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground"
              )}
            >
              Gramos
            </button>
          </div>

          <select
            aria-label="Comida"
            value={mealCategory}
            onChange={(e) => setMealCategory(e.target.value as MealCategory)}
            className="w-full h-10 px-3 rounded-xl bg-card border border-border text-foreground text-xs font-bold appearance-none focus:outline-none"
          >
            <option value="Desayuno">Desayuno</option>
            <option value="Almuerzo">Almuerzo</option>
            <option value="Merienda">Merienda</option>
            <option value="Cena">Cena</option>
            <option value="Snacks">Snack</option>
          </select>
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-2xl border border-border">
          <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center text-muted-foreground">
            <ChefHat className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-[9px] font-semibold uppercase text-muted-foreground tracking-widest mb-0.5">Cantidad</p>
            <div className="flex items-center">
              <Input
                type="number"
                aria-label="Cantidad"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-7 bg-transparent border-none text-foreground p-0 text-xl font-semibold focus-visible:ring-0"
              />
              <span className="text-primary font-bold text-xs uppercase ml-2">
                {mode === 'servings' ? "porc" : "g"}
              </span>
            </div>
          </div>
        </div>

        {mode === 'servings' && gramsPerServing > 0 && (
          <p className="text-[11px] text-muted-foreground px-1">
            Una porción son {Math.round(gramsPerServing)} g.
          </p>
        )}

        {!canLog && (
          <p className="text-[11px] text-chart-5 px-1">
            Esta receta no tiene datos suficientes para cargarla al diario.
          </p>
        )}

        <div className="flex flex-col gap-3 pt-2">
          <Button
            onClick={handleSave}
            disabled={!canLog || isSaving}
            className="w-full h-14 text-sm font-semibold uppercase tracking-widest shadow-xl shadow-primary/20"
          >
            {isSaving ? "Guardando..." : "Confirmar Registro"}
          </Button>
        </div>
      </div>
    </div>
  )
}
