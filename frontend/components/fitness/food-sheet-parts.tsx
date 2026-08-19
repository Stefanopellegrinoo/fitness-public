"use client"

import { Scale, Star, ChefHat } from "lucide-react"
import { Input } from "@/components/ui/input"
import { FoodItem, RecipeListItem } from "@/lib/types/api.types"
import { cn } from "@/lib/utils"

/**
 * Presentational leaves shared by the food sheet and the recipe picker.
 *
 * They live here rather than being exported from `add-food-sheet.tsx` because
 * `add-food-sheet` imports the recipe picker: exporting from there would close
 * the import cycle.
 */

export function BrowseSpinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-6 w-6 rounded-full border-2 border-t-primary border-border animate-spin" />
    </div>
  )
}

/**
 * The star is optional: the recipe editor picks an ingredient without any
 * favourites to manage, and rendering a dead star there would be a lie.
 */
export function FoodResultRow({
  food,
  isFavorite = false,
  onSelect,
  onToggleFavorite,
}: {
  food: FoodItem
  isFavorite?: boolean
  onSelect: (food: FoodItem) => void
  onToggleFavorite?: (food: FoodItem) => void
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-card border border-border rounded-2xl hover:bg-accent transition-all group">
      <button
        type="button"
        onClick={() => onSelect(food)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
      >
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Scale className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="text-foreground font-bold text-sm tracking-tight truncate">{food.name}</h3>
          <p className="text-muted-foreground text-xs font-medium uppercase truncate">{food.brand || "Genérico"}</p>
        </div>
      </button>
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right mr-1">
          <p className="text-foreground font-bold text-xs">
            {food.caloriesPer100g != null ? `${Math.round(food.caloriesPer100g)} kcal` : '—'}
          </p>
        </div>
        {onToggleFavorite && (
          <button
            type="button"
            aria-label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
            aria-pressed={isFavorite}
            onClick={() => onToggleFavorite(food)}
            className="h-9 w-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
          >
            <Star className={cn("h-4 w-4", isFavorite ? "fill-primary text-primary" : "")} />
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * A recipe as it appears among search results.
 *
 * Deliberately not the row the Recetas tab uses: there the user is managing
 * recipes (ingredient count, yield, a pencil), here they are picking something
 * to eat. What both must show is that this is a RECIPE and not a catalog item —
 * a recipe has no brand, and falling back to "Genérico" would disguise it as one.
 */
export function RecipeResultRow({
  recipe,
  onSelect,
}: {
  recipe: RecipeListItem
  onSelect: (recipe: RecipeListItem) => void
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-card border border-primary/30 rounded-2xl hover:bg-accent transition-all">
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
          <p className="text-primary text-xs font-medium uppercase truncate">Receta</p>
        </div>
      </button>
      <div className="text-right shrink-0 ml-2">
        <p className="text-foreground font-bold text-xs">
          {Math.round(recipe.nutrition.perServing.calories)} kcal
        </p>
        <p className="text-muted-foreground text-[10px] font-medium uppercase">por porción</p>
      </div>
    </div>
  )
}

export function MacroCompact({ value, label, color }: { value: string, label: string, color: string }) {
  return (
    <div className="bg-black/30 rounded-xl py-2 px-1 border border-border flex flex-col items-center">
      <span className={cn("text-sm font-semibold tracking-tighter leading-none", color)}>{Math.round(parseFloat(value) || 0)}</span>
      <span className="text-[7px] font-bold uppercase text-muted-foreground tracking-tighter mt-1">{label}</span>
    </div>
  )
}

export function MacroInputSmall({ label, value, onChange, color }: { label: string, value: string, onChange: (v: string) => void, color: string }) {
  return (
    <div className={cn("bg-card p-2.5 rounded-2xl border flex flex-col gap-0.5", color)}>
      <label className="text-[8px] font-semibold uppercase tracking-widest text-muted-foreground ml-0.5">{label}</label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 bg-transparent border-none text-foreground p-0 text-sm font-bold focus-visible:ring-0"
      />
    </div>
  )
}
