"use client"

import { useState, useEffect, useRef } from "react"
import { Search, ScanLine, LayoutGrid } from "lucide-react"
import { Input } from "@/components/ui/input"
import { BarcodeScanner } from "@/components/fitness/barcode-scanner"
import { BrowseSpinner, FoodResultRow, RecipeResultRow } from "@/components/fitness/food-sheet-parts"
import { foodService } from "@/lib/api/food.service"
import { recipeService } from "@/lib/api/recipe.service"
import { FoodItem, RecipeListItem } from "@/lib/types/api.types"
import { toast } from "sonner"

/**
 * The two ways to find a food item, extracted from the add-food sheet so the
 * recipe editor can reuse them when adding an ingredient.
 *
 * They stay as two components rather than one picker because the sheet shows
 * them in two separate tabs, while the editor stacks them in one surface. What
 * they share is the callback shape: neither one decides what happens to the
 * food it found — the caller does. In the sheet a found food goes to the amount
 * step; in the editor it becomes an ingredient.
 *
 * Favorites are optional. The sheet passes them so the star renders; the editor
 * has no favorites to manage and omits them, which is also why this does NOT own
 * the favorites state: Recientes and Favoritos stay in the sheet, and a second
 * copy of that state here would drift from theirs.
 */

const SEARCH_DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

export function FoodSearchPanel({
  onPick,
  favoriteIds,
  onToggleFavorite,
  placeholder = "Buscar alimento...",
  includeRecipes = false,
  onPickRecipe,
}: {
  onPick: (food: FoodItem) => void
  favoriteIds?: Set<string>
  onToggleFavorite?: (food: FoodItem) => void
  placeholder?: string
  /**
   * OFF by default, and that default is load-bearing. The recipe editor uses
   * this same panel to pick an INGREDIENT, and a recipe is not a FoodItem: its
   * id is absent from the catalog, so the backend would answer 400 'Alimento
   * inexistente'. Only the sheet's Buscar tab opts in.
   */
  includeRecipes?: boolean
  onPickRecipe?: (recipe: RecipeListItem) => void
}) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<FoodItem[]>([])
  const [recipeResults, setRecipeResults] = useState<RecipeListItem[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery.length >= MIN_QUERY_LENGTH) {
        setIsLoading(true)
        // Both run at once, but each swallows its own failure: the recipe list
        // is local and cheap while the food search goes through the OFF proxy,
        // and a Promise.all would let either one blank out the other's results.
        const [foods, recipes] = await Promise.all([
          foodService.searchFoods(searchQuery).catch((error) => {
            console.error("Error searching foods:", error)
            return [] as FoodItem[]
          }),
          includeRecipes
            ? recipeService
                .getRecipes(searchQuery)
                .then((page) => page.items)
                .catch((error) => {
                  console.error("Error searching recipes:", error)
                  return [] as RecipeListItem[]
                })
            : Promise.resolve([] as RecipeListItem[]),
        ])
        setSearchResults(foods)
        setRecipeResults(recipes)
        setIsLoading(false)
      } else {
        setSearchResults([])
        setRecipeResults([])
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [searchQuery, includeRecipes])

  return (
    <>
      <div className="relative mb-4">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={placeholder}
          className="h-12 pl-11 bg-card border-border text-foreground rounded-2xl placeholder:text-muted-foreground focus:ring-primary/20"
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pb-6">
        {isLoading ? (
          <BrowseSpinner />
        ) : recipeResults.length > 0 || searchResults.length > 0 ? (
          <>
            {/* Recipes first: what the user cooked beats what the catalog holds. */}
            {onPickRecipe &&
              recipeResults.map((recipe) => (
                <RecipeResultRow key={recipe.id} recipe={recipe} onSelect={onPickRecipe} />
              ))}
            {searchResults.map((food) => (
              <FoodResultRow
                key={food.id}
                food={food}
                isFavorite={favoriteIds?.has(food.id) ?? false}
                onSelect={onPick}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </>
        ) : searchQuery.length >= MIN_QUERY_LENGTH ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm">No hay resultados</p>
          </div>
        ) : (
          <div className="text-center py-12 opacity-20">
            <LayoutGrid className="h-10 w-10 mx-auto mb-2" />
            <p className="text-xs font-bold uppercase tracking-[0.2em]">Escribí para buscar</p>
          </div>
        )}
      </div>
    </>
  )
}

export function FoodScanPanel({
  active,
  onPick,
  onFallbackToSearch,
}: {
  active: boolean
  onPick: (food: FoodItem) => void
  onFallbackToSearch?: () => void
}) {
  const [scanError, setScanError] = useState<'permission' | 'unavailable' | null>(null)
  // A lookup in flight, and the last code that came back empty. Without them a
  // barcode still in frame gets decoded on every camera tick.
  const scanningLockRef = useRef(false)
  const lastRejectedRef = useRef<string | null>(null)

  // Re-entering retries the camera and forgets the rejected code.
  useEffect(() => {
    if (active) {
      setScanError(null)
      lastRejectedRef.current = null
    }
  }, [active])

  const handleScannedCode = async (code: string) => {
    if (scanningLockRef.current) return
    if (code === lastRejectedRef.current) return
    scanningLockRef.current = true
    try {
      const food = await foodService.getFoodByBarcode(code)
      if (food) {
        onPick(food)
      } else {
        lastRejectedRef.current = code
        toast.error("No encontramos ese código de barras", { id: 'barcode-miss' })
      }
    } catch (error) {
      console.error("Error looking up barcode:", error)
      toast.error("No pudimos buscar el código. Intentá de nuevo.")
    } finally {
      scanningLockRef.current = false
    }
  }

  if (scanError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <ScanLine className="h-12 w-12 mb-3 text-muted-foreground" />
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-foreground">
          {scanError === 'permission' ? "Necesitamos la cámara" : "Cámara no disponible"}
        </p>
        <p className="text-[11px] text-muted-foreground mt-2">
          {scanError === 'permission'
            ? "Activá el permiso de cámara o buscá el alimento por nombre."
            : "No pudimos abrir la cámara en este dispositivo. Buscá el alimento por nombre."}
        </p>
        {onFallbackToSearch && (
          <button
            type="button"
            onClick={onFallbackToSearch}
            className="text-primary text-xs font-semibold mt-4 uppercase tracking-widest"
          >
            Buscar por nombre
          </button>
        )}
      </div>
    )
  }

  return (
    <BarcodeScanner
      active={active}
      onScan={handleScannedCode}
      onError={(kind) => setScanError(kind)}
    />
  )
}
