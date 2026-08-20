"use client"

import { useState, useEffect } from "react"
import { X, Search, Plus, ChevronRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { exerciseService } from "@/lib/api/exercise.service"
import { Exercise } from "@/lib/types/api.types"
import { toast } from "sonner"
import { ErrorState } from "@/components/fitness/error-state"

interface ExerciseSelectorProps {
  open: boolean
  onClose: () => void
  onSelect: (exercise: Exercise) => void
}

const muscleGroups = [
  { id: "all", name: "Todos" },
  { id: "PECHO", name: "Pecho" },
  { id: "ESPALDA", name: "Espalda" },
  { id: "HOMBROS", name: "Hombros" },
  { id: "BRAZOS", name: "Brazos" },
  { id: "PIERNAS", name: "Piernas" },
  { id: "CORE", name: "Core" },
  { id: "CARDIO", name: "Cardio" },
]

// Categorical taxonomy colors per muscle group — intentionally distinct from
// the primary/brand palette (kept as-is in the redesign).
const muscleGroupColors: Record<string, string> = {
  PECHO: "bg-red-900/30 text-red-400",
  ESPALDA: "bg-blue-900/30 text-blue-400", // Fix: should be blue but backend uses this
  HOMBROS: "bg-orange-900/30 text-orange-400",
  BRAZOS: "bg-purple-900/30 text-purple-400",
  PIERNAS: "bg-green-900/30 text-green-400",
  CORE: "bg-yellow-900/30 text-yellow-400",
  CARDIO: "bg-pink-900/30 text-pink-400",
}

export function ExerciseSelector({ open, onClose, onSelect }: ExerciseSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedGroup, setSelectedGroup] = useState("all")
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newCategory, setNewCategory] = useState("PECHO")

  useEffect(() => {
    if (open) {
      fetchExercises()
      setSearchQuery("")
      setIsCreating(false)
    }
  }, [open])

  const fetchExercises = async () => {
    try {
      setIsLoading(true)
      setFetchError(null)
      const data = await exerciseService.getAll()
      setExercises(data)
    } catch (error) {
      console.error("Failed to fetch exercises:", error)
      setFetchError("No pudimos cargar los ejercicios. Revisá tu conexión e intentá de nuevo.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateExercise = async () => {
    if (!newName.trim()) {
      toast.error("Por favor ingresá un nombre")
      return
    }

    try {
      setIsLoading(true)
      const newExercise = await exerciseService.create({
        name: newName,
        category: newCategory
      })
      toast.success("Ejercicio creado")
      onSelect(newExercise)
      onClose()
    } catch (error) {
      console.error("Error creating exercise:", error)
      toast.error("No pudimos crear el ejercicio. Intentá de nuevo.")
    } finally {
      setIsLoading(false)
    }
  }

  const filteredExercises = exercises.filter((exercise) => {
    const matchesSearch = exercise.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesGroup =
      selectedGroup === "all" ||
      exercise.category === selectedGroup
    return matchesSearch && matchesGroup
  })

  return (
    <Sheet open={open} onOpenChange={() => onClose()}>
      <SheetContent
        side="bottom"
        className="bg-background border-t border-border rounded-t-3xl h-[90vh] overflow-hidden flex flex-col px-4"
      >
        <SheetHeader className="flex flex-row items-center justify-between pb-4 px-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={isCreating ? () => setIsCreating(false) : onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              {isCreating ? <ChevronRight className="h-5 w-5 rotate-180" /> : <X className="h-5 w-5" />}
            </Button>
            <SheetTitle className="text-foreground text-lg font-bold">
              {isCreating ? "Nuevo Ejercicio" : "Seleccionar ejercicio"}
            </SheetTitle>
          </div>
          <SheetDescription className="sr-only">
            Busca y selecciona un ejercicio de la lista
          </SheetDescription>
        </SheetHeader>

        {isCreating ? (
          <div className="space-y-6 pt-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Nombre</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej: Press Militar con Barra"
                className="bg-card border-border text-foreground text-lg py-6"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Categoría</label>
              <div className="grid grid-cols-2 gap-2">
                {muscleGroups.filter(g => g.id !== "all").map((group) => (
                  <Button
                    key={group.id}
                    variant={newCategory === group.id ? "default" : "outline"}
                    onClick={() => setNewCategory(group.id)}
                    className={cn(
                      "justify-start text-xs font-bold uppercase tracking-wider h-12",
                      newCategory !== group.id && "border-border text-muted-foreground"
                    )}
                  >
                    {group.name}
                  </Button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleCreateExercise}
              disabled={isLoading}
              className="w-full py-6 text-base font-semibold uppercase tracking-widest mt-8"
            >
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Crear y Seleccionar"}
            </Button>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar ejercicio..."
                className="pl-10 bg-card border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            {/* Muscle Group Filters */}
            <div className="flex gap-2 overflow-x-auto pb-4 mb-2">
              {muscleGroups.map((group) => (
                <Button
                  key={group.id}
                  variant={selectedGroup === group.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedGroup(group.id)}
                  className={cn(
                    "whitespace-nowrap",
                    selectedGroup !== group.id && "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {group.name}
                </Button>
              ))}
            </div>

            {/* Create New Exercise Trigger */}
            <div
              onClick={() => {
                setIsCreating(true)
                setNewName(searchQuery)
              }}
              className="border-2 border-dashed border-border rounded-xl p-4 mb-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
            >
              <Button variant="ghost" className="text-primary hover:text-primary/80 hover:bg-transparent p-0">
                <Plus className="h-4 w-4 mr-2" />
                Crear Nuevo Ejercicio "{searchQuery}"
              </Button>
            </div>

            {/* Exercise List */}
            <div className="flex-1 overflow-y-auto space-y-1">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin mb-2" />
                  <p>Cargando ejercicios...</p>
                </div>
              ) : fetchError ? (
                <ErrorState description={fetchError} onRetry={fetchExercises} />
              ) : filteredExercises.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No se encontraron ejercicios</p>
                </div>
              ) : (
                filteredExercises.map((exercise) => (
                  <div
                    key={exercise.id}
                    onClick={() => {
                      onSelect(exercise)
                      onClose()
                    }}
                    className="flex items-center justify-between p-4 hover:bg-card rounded-xl cursor-pointer transition-colors"
                  >
                    <div>
                      <h3 className="text-foreground font-medium">{exercise.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={cn(
                            "text-xs px-2 py-0.5 rounded",
                            muscleGroupColors[exercise.category] || "bg-muted text-muted-foreground"
                          )}
                        >
                          {exercise.category}
                        </span>
                        {exercise.difficulty && (
                          <span className="text-muted-foreground text-xs">{exercise.difficulty}</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
