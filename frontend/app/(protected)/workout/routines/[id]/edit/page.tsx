"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ErrorState } from "@/components/fitness/error-state"
import { RoutineForm } from "@/components/fitness/routine-form"
import { routineService } from "@/lib/api/routine.service"
import { fromRoutine, RoutineDraft } from "@/lib/routines/routine-mapping"
import type { CreateRoutinePayload } from "@/lib/types/api.types"

export default function EditRoutinePage() {
  const router = useRouter()
  const params = useParams()
  const routineId = params.id as string

  const [initial, setInitial] = useState<RoutineDraft | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRoutine = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const routine = await routineService.getById(routineId)
      setInitial(fromRoutine(routine))
    } catch (err) {
      console.error("Error fetching routine:", err)
      setError("No pudimos cargar la rutina. Revisá tu conexión e intentá de nuevo.")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (routineId) fetchRoutine()
  }, [routineId])

  const handleSubmit = async (payload: CreateRoutinePayload) => {
    setSubmitting(true)
    try {
      await routineService.update(routineId, payload)
      router.push("/workout")
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading && !error) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <>
        <div className="flex items-center gap-3 mb-8">
          <Link href="/workout">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-accent">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">Editar Rutina</h1>
        </div>
        <ErrorState description={error} onRetry={fetchRoutine} />
      </>
    )
  }

  // RoutineForm renders the full page chrome (header, steps).
  return initial ? (
    <RoutineForm
      mode="edit"
      initial={initial}
      submitting={submitting}
      onSubmit={handleSubmit}
    />
  ) : null
}
