"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { RoutineForm } from "@/components/fitness/routine-form"
import { routineService } from "@/lib/api/routine.service"
import type { CreateRoutinePayload } from "@/lib/types/api.types"

export default function CreateRoutinePage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (payload: CreateRoutinePayload) => {
    setSubmitting(true)
    try {
      await routineService.create(payload)
      router.push("/workout")
    } finally {
      setSubmitting(false)
    }
  }

  // RoutineForm renders the full page chrome (header, steps).
  return <RoutineForm mode="create" submitting={submitting} onSubmit={handleSubmit} />
}
