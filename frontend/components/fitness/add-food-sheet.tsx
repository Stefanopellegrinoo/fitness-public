"use client"

import { useState, useEffect, useRef } from "react"
import { X, Search, Plus, ArrowLeft, Weight, Flame, Database, Star, Clock, ScanLine, LayoutGrid, ChefHat } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { BrowseSpinner, FoodResultRow, MacroCompact, MacroInputSmall } from "@/components/fitness/food-sheet-parts"
import { FoodSearchPanel, FoodScanPanel } from "@/components/fitness/food-picker"
import { RecipeTab, RecipeAmountStep } from "@/components/fitness/recipe-picker"
import { RecipeEditorSheet } from "@/components/fitness/recipe-editor-sheet"
import { foodService } from "@/lib/api/food.service"
import { FoodItem, CreateNutritionEntryPayload, RecipeListItem } from "@/lib/types/api.types"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface AddFoodSheetProps {
  open: boolean
  onClose: () => void
  onAdd: (entry: CreateNutritionEntryPayload) => Promise<void>
}

type MealCategory = 'Desayuno' | 'Almuerzo' | 'Merienda' | 'Cena' | 'Snacks';
type BrowseTab = 'recientes' | 'favoritos' | 'buscar' | 'escanear' | 'recetas';

export function AddFoodSheet({ open, onClose, onAdd }: AddFoodSheetProps) {
  const [step, setStep] = useState<'browse' | 'amount' | 'custom' | 'recipe-amount'>('browse')
  const [activeTab, setActiveTab] = useState<BrowseTab>('recientes')
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null)
  // Kept apart from selectedFood on purpose: handleSaveEntry reads
  // selectedFood.id into the payload's foodItemId, and a recipe id is not a
  // FoodItem id — the backend would persist it into the foreign key.
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeListItem | null>(null)
  // null with the editor open means "creating"; an id means "editing that one".
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null)
  // Bumped after a save or a delete so the tab re-fetches: a recipe the list
  // does not reload is invisible until the sheet is reopened, which reads as
  // "it did not save".
  const [recipesReloadToken, setRecipesReloadToken] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [saveToCatalog, setSaveToCatalog] = useState(false)
  const [isCustomGramBased, setIsCustomGramBased] = useState(true)

  const [recentFoods, setRecentFoods] = useState<FoodItem[]>([])
  const [favoriteFoods, setFavoriteFoods] = useState<FoodItem[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [isLoadingBrowse, setIsLoadingBrowse] = useState(false)

  const [entryData, setEntryData] = useState({
    amount: "100",
    mealCategory: 'Desayuno' as MealCategory,
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
    name: ""
  })

  // Load recent + favorites when the sheet opens
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setIsLoadingBrowse(true)
    Promise.all([foodService.getRecentFoods(), foodService.getFavorites()])
      .then(([recent, favs]) => {
        if (cancelled) return
        setRecentFoods(recent)
        setFavoriteFoods(favs)
        setFavoriteIds(new Set(favs.map((f) => f.id)))
      })
      .catch(() => {
        if (!cancelled) toast.error("No pudimos cargar tus alimentos. Intentá de nuevo.")
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBrowse(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const toggleFavorite = async (food: FoodItem) => {
    const id = food.id
    const wasFavorite = favoriteIds.has(id)

    // Optimistic update
    setFavoriteIds((prev) => {
      const next = new Set(prev)
      if (wasFavorite) next.delete(id)
      else next.add(id)
      return next
    })
    if (wasFavorite) {
      setFavoriteFoods((prev) => prev.filter((f) => f.id !== id))
    } else {
      setFavoriteFoods((prev) => (prev.some((f) => f.id === id) ? prev : [food, ...prev]))
    }

    try {
      if (wasFavorite) {
        await foodService.removeFavorite(id)
      } else {
        await foodService.addFavorite(id)
      }
    } catch (error) {
      console.error("Error toggling favorite:", error)
      // Revert
      setFavoriteIds((prev) => {
        const next = new Set(prev)
        if (wasFavorite) next.add(id)
        else next.delete(id)
        return next
      })
      if (wasFavorite) {
        setFavoriteFoods((prev) => (prev.some((f) => f.id === id) ? prev : [food, ...prev]))
      } else {
        setFavoriteFoods((prev) => prev.filter((f) => f.id !== id))
      }
      toast.error("No pudimos actualizar favoritos. Intentá de nuevo.")
    }
  }

  const handleSelectFood = (food: FoodItem) => {
    setSelectedFood(food)
    setEntryData({
      ...entryData,
      name: food.name,
      amount: food.isGramBased ? "100" : "1",
      calories: food.caloriesPer100g?.toString() || "",
      protein: food.proteinPer100g?.toString() || "",
      carbs: food.carbsPer100g?.toString() || "",
      fat: food.fatPer100g?.toString() || ""
    })
    setStep('amount')
  }

  const calculateMacros = (amount: string) => {
    setEntryData(prev => ({ ...prev, amount }))

    if (!selectedFood && step !== 'custom') return

    const numAmount = parseFloat(amount) || 0
    const isGramBased = step === 'custom' ? isCustomGramBased : (selectedFood?.isGramBased ?? true)
    const ratio = isGramBased ? numAmount / 100 : numAmount

    if (selectedFood) {
      setEntryData(prev => ({
        ...prev,
        calories: Math.round((selectedFood.caloriesPer100g || 0) * ratio).toString(),
        protein: ((selectedFood.proteinPer100g || 0) * ratio).toFixed(1),
        carbs: ((selectedFood.carbsPer100g || 0) * ratio).toFixed(1),
        fat: ((selectedFood.fatPer100g || 0) * ratio).toFixed(1)
      }))
    }
  }

  const handleSaveEntry = async () => {
    setIsSaving(true)
    try {
      let foodItemId = selectedFood?.id;

      if (step === 'custom' && saveToCatalog) {
        const amount = parseFloat(entryData.amount) || 100;
        const ratio = isCustomGramBased ? (amount / 100) : amount;

        const newFood = await foodService.createFood({
          name: entryData.name,
          isGramBased: isCustomGramBased,
          caloriesPer100g: (parseFloat(entryData.calories) || 0) / ratio,
          proteinPer100g: (parseFloat(entryData.protein) || 0) / ratio,
          carbsPer100g: (parseFloat(entryData.carbs) || 0) / ratio,
          fatPer100g: (parseFloat(entryData.fat) || 0) / ratio,
          servingName: isCustomGramBased ? "100g" : "1 unidad"
        });
        foodItemId = newFood.id;
      }

      const payload: CreateNutritionEntryPayload = {
        foodName: entryData.name,
        foodItemId,
        grams: parseFloat(entryData.amount) || 0,
        mealCategory: entryData.mealCategory,
        ...(entryData.calories && { calories: parseFloat(entryData.calories) }),
        ...(entryData.protein && { protein: parseFloat(entryData.protein) }),
        ...(entryData.carbs && { carbs: parseFloat(entryData.carbs) }),
        ...(entryData.fat && { fat: parseFloat(entryData.fat) }),
      }

      await onAdd(payload)
      handleClose()
    } catch (error) {
      console.error("Error saving nutrition entry:", error)
      toast.error("No pudimos guardar el alimento. Intentá de nuevo.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
    onClose()
    setTimeout(() => {
      // The search query and the scan state are no longer reset here: they live
      // inside FoodSearchPanel / FoodScanPanel now, and both are unmounted when
      // the sheet closes, so they come back fresh on their own. Verified by test.
      setStep('browse')
      setActiveTab('recientes')
      setSelectedFood(null)
      setSelectedRecipe(null)
      setSaveToCatalog(false)
      setIsCustomGramBased(true)
      setRecentFoods([])
      setFavoriteFoods([])
      setFavoriteIds(new Set())
      setEntryData({
        amount: "100",
        mealCategory: 'Desayuno',
        calories: "",
        protein: "",
        carbs: "",
        fat: "",
        name: ""
      })
    }, 300)
  }

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <SheetContent
        side="bottom"
        className="bg-background border-t border-border rounded-t-[2.5rem] h-[85vh] overflow-hidden flex flex-col focus:outline-none"
      >
        <SheetHeader className="flex flex-row items-center justify-between pb-4 px-4">
          <div className="flex items-center gap-3">
            {step !== 'browse' ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setStep('browse')}
                className="h-9 w-9 rounded-xl bg-white/5 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="h-9 w-9 rounded-xl bg-white/5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            <div>
              <SheetTitle className="text-foreground text-lg font-bold tracking-tight leading-tight">
                {step === 'browse' ? "Agregar Comida" :
                 step === 'custom' ? "Nuevo Alimento" : "Ajustar"}
              </SheetTitle>
            </div>
          </div>
        </SheetHeader>

        {step === 'browse' && (
          <div className="flex-1 flex flex-col px-4 overflow-hidden">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as BrowseTab)}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <TabsList className="grid grid-cols-5 w-full h-auto mb-4">
                <TabsTrigger value="recientes" className="flex-col gap-1 py-2">
                  <Clock className="h-4 w-4" />
                  <span className="text-[10px] font-semibold">Recientes</span>
                </TabsTrigger>
                <TabsTrigger value="favoritos" className="flex-col gap-1 py-2">
                  <Star className="h-4 w-4" />
                  <span className="text-[10px] font-semibold">Favoritos</span>
                </TabsTrigger>
                <TabsTrigger value="buscar" className="flex-col gap-1 py-2">
                  <Search className="h-4 w-4" />
                  <span className="text-[10px] font-semibold">Buscar</span>
                </TabsTrigger>
                <TabsTrigger value="escanear" className="flex-col gap-1 py-2">
                  <ScanLine className="h-4 w-4" />
                  <span className="text-[10px] font-semibold">Escanear</span>
                </TabsTrigger>
                <TabsTrigger value="recetas" className="flex-col gap-1 py-2">
                  <ChefHat className="h-4 w-4" />
                  <span className="text-[10px] font-semibold">Recetas</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="recientes" className="flex-1 overflow-y-auto space-y-2 pb-6">
                {isLoadingBrowse ? (
                  <BrowseSpinner />
                ) : recentFoods.length > 0 ? (
                  recentFoods.map((food) => (
                    <FoodResultRow
                      key={food.id}
                      food={food}
                      isFavorite={favoriteIds.has(food.id)}
                      onSelect={handleSelectFood}
                      onToggleFavorite={toggleFavorite}
                    />
                  ))
                ) : (
                  <div className="text-center py-12 opacity-40">
                    <Clock className="h-10 w-10 mx-auto mb-2" />
                    <p className="text-xs font-bold uppercase tracking-[0.2em]">Todavía no registraste alimentos</p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('buscar')}
                      className="text-primary text-xs font-semibold mt-3 uppercase tracking-widest"
                    >
                      Buscar un alimento
                    </button>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="favoritos" className="flex-1 overflow-y-auto space-y-2 pb-6">
                {isLoadingBrowse ? (
                  <BrowseSpinner />
                ) : favoriteFoods.length > 0 ? (
                  favoriteFoods.map((food) => (
                    <FoodResultRow
                      key={food.id}
                      food={food}
                      isFavorite={favoriteIds.has(food.id)}
                      onSelect={handleSelectFood}
                      onToggleFavorite={toggleFavorite}
                    />
                  ))
                ) : (
                  <div className="text-center py-12 opacity-40">
                    <Star className="h-10 w-10 mx-auto mb-2" />
                    <p className="text-xs font-bold uppercase tracking-[0.2em]">Sin favoritos todavía</p>
                    <p className="text-[11px] text-muted-foreground mt-2 normal-case tracking-normal">
                      Tocá la estrella en un alimento para guardarlo acá.
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="buscar" className="flex-1 flex flex-col overflow-hidden">
                <FoodSearchPanel
                  onPick={handleSelectFood}
                  favoriteIds={favoriteIds}
                  onToggleFavorite={toggleFavorite}
                  includeRecipes
                  onPickRecipe={(recipe) => {
                    setSelectedRecipe(recipe)
                    setStep('recipe-amount')
                  }}
                />
              </TabsContent>

              <TabsContent value="escanear" className="flex-1 flex flex-col pb-6">
                <FoodScanPanel
                  active={activeTab === 'escanear'}
                  onPick={handleSelectFood}
                  onFallbackToSearch={() => setActiveTab('buscar')}
                />
              </TabsContent>

              <TabsContent value="recetas" className="flex-1 overflow-y-auto space-y-2 pb-6">
                <RecipeTab
                  active={activeTab === 'recetas'}
                  reloadToken={recipesReloadToken}
                  onSelect={(recipe) => {
                    setSelectedRecipe(recipe)
                    setStep('recipe-amount')
                  }}
                  onEdit={(recipe) => {
                    setEditingRecipeId(recipe.id)
                    setIsEditorOpen(true)
                  }}
                />
              </TabsContent>
            </Tabs>

            {/* One slot, one intent: create the kind of thing this tab lists. */}
            {activeTab === 'recetas' ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditingRecipeId(null)
                  setIsEditorOpen(true)
                }}
                className="h-12 border-dashed border-border bg-white/5 mb-4 flex items-center justify-center gap-3 text-primary hover:bg-primary/10 transition-all"
              >
                <Plus className="h-4 w-4" />
                <span className="font-semibold text-xs uppercase tracking-widest">Nueva receta</span>
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setStep('custom')
                  setEntryData({ ...entryData, name: "" })
                }}
                className="h-12 border-dashed border-border bg-white/5 mb-4 flex items-center justify-center gap-3 text-primary hover:bg-primary/10 transition-all"
              >
                <Plus className="h-4 w-4" />
                <span className="font-semibold text-xs uppercase tracking-widest">Alimento Personalizado</span>
              </Button>
            )}
          </div>
        )}

        {step === 'recipe-amount' && selectedRecipe && (
          <RecipeAmountStep recipe={selectedRecipe} onAdd={onAdd} onSaved={handleClose} />
        )}

        {(step === 'amount' || step === 'custom') && (
          <div className="flex-1 flex flex-col px-4 overflow-y-auto pb-6">
            {/* COMPACT Food Summary & Live Macros */}
            <div className="bg-card border border-border rounded-3xl p-4 mb-4 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
                  <Flame className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  {step === 'custom' ? (
                    <Input
                      autoFocus
                      value={entryData.name}
                      onChange={(e) => setEntryData({ ...entryData, name: e.target.value })}
                      placeholder="Nombre del alimento..."
                      className="h-8 bg-transparent border-none text-foreground text-lg font-bold p-0 placeholder:text-white/20 focus-visible:ring-0"
                    />
                  ) : (
                    <h4 className="text-foreground font-bold text-lg tracking-tight truncate">{selectedFood?.name}</h4>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                <MacroCompact value={entryData.calories} label="kcal" color="text-foreground" />
                <MacroCompact value={entryData.protein} label="P" color="text-destructive" />
                <MacroCompact value={entryData.carbs} label="C" color="text-chart-5" />
                <MacroCompact value={entryData.fat} label="G" color="text-primary" />
              </div>
            </div>

            <div className="space-y-4 px-1">
              {/* Type & Meal Category in one row */}
              <div className="grid grid-cols-2 gap-3">
                {step === 'custom' ? (
                  <div className="flex bg-card rounded-xl p-1 border border-border">
                    <button
                      onClick={() => setIsCustomGramBased(true)}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-all",
                        isCustomGramBased ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground"
                      )}
                    >
                      Peso
                    </button>
                    <button
                      onClick={() => setIsCustomGramBased(false)}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-all",
                        !isCustomGramBased ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground"
                      )}
                    >
                      Unidad
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center px-3 bg-card rounded-xl border border-border">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Comida</span>
                  </div>
                )}

                <select
                  value={entryData.mealCategory}
                  onChange={(e) => setEntryData({ ...entryData, mealCategory: e.target.value as MealCategory })}
                  className="w-full h-10 px-3 rounded-xl bg-card border border-border text-foreground text-xs font-bold appearance-none focus:outline-none"
                >
                  <option value="Desayuno">Desayuno</option>
                  <option value="Almuerzo">Almuerzo</option>
                  <option value="Merienda">Merienda</option>
                  <option value="Cena">Cena</option>
                  <option value="Snacks">Snack</option>
                </select>
              </div>

              {/* Amount Row */}
              <div className="flex items-center gap-3 bg-card p-3 rounded-2xl border border-border">
                <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center text-muted-foreground">
                  <Weight className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="text-[9px] font-semibold uppercase text-muted-foreground tracking-widest mb-0.5">Cantidad</p>
                  <div className="flex items-center">
                    <Input
                      type="number"
                      value={entryData.amount}
                      onChange={(e) => calculateMacros(e.target.value)}
                      className="h-7 bg-transparent border-none text-foreground p-0 text-xl font-semibold focus-visible:ring-0"
                    />
                    <span className="text-primary font-bold text-xs uppercase ml-2">
                      {step === 'amount'
                        ? (selectedFood?.isGramBased ? "g" : "ud")
                        : (isCustomGramBased ? "g" : "ud")
                      }
                    </span>
                  </div>
                </div>
              </div>

              {/* Macros Grid - Compact */}
              <div className="grid grid-cols-2 gap-3">
                <MacroInputSmall label="Proteína (g)" value={entryData.protein} onChange={(v) => setEntryData({...entryData, protein: v})} color="border-destructive/20" />
                <MacroInputSmall label="Carbos (g)" value={entryData.carbs} onChange={(v) => setEntryData({...entryData, carbs: v})} color="border-chart-5/20" />
                <MacroInputSmall label="Grasas (g)" value={entryData.fat} onChange={(v) => setEntryData({...entryData, fat: v})} color="border-orange-500/20" />
                <MacroInputSmall label="Calorías" value={entryData.calories} onChange={(v) => setEntryData({...entryData, calories: v})} color="border-border" />
              </div>

              <div className="flex flex-col gap-3 pt-2">
                {step === 'custom' && (
                  <div
                    onClick={() => setSaveToCatalog(!saveToCatalog)}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer",
                      saveToCatalog ? "bg-success/10 border-success/30" : "bg-white/5 border-border"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Database className={cn("h-4 w-4", saveToCatalog ? "text-success" : "text-muted-foreground")} />
                      <span className="text-foreground text-xs font-bold">Guardar en catálogo</span>
                    </div>
                    <div className={cn(
                      "h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all",
                      saveToCatalog ? "bg-success border-success" : "border-border"
                    )}>
                      {saveToCatalog && <X className="h-3 w-3 text-success-foreground rotate-45" />}
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleSaveEntry}
                  disabled={(!entryData.name && !selectedFood) || isSaving}
                  className="w-full h-14 text-sm font-semibold uppercase tracking-widest shadow-xl shadow-primary/20"
                >
                  {isSaving ? "Guardando..." : saveToCatalog ? "Guardar y Registrar" : "Confirmar Registro"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>

      <RecipeEditorSheet
        open={isEditorOpen}
        recipeId={editingRecipeId}
        onClose={() => setIsEditorOpen(false)}
        onSaved={() => setRecipesReloadToken((token) => token + 1)}
      />
    </Sheet>
  )
}

