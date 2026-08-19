import type { Weekday } from "@/lib/types/api.types"

// Weekday-based days: the routine is built by toggling days of the week (the flow
// the user prefers). Each selected weekday becomes a first-class RoutineDay
// (name = weekday label, weekday = anchor) when the nested payload is generated.
export const daysOfWeek: { code: string; name: string; weekday: Weekday }[] = [
  { code: "L", name: "Lunes", weekday: "LUNES" },
  { code: "M", name: "Martes", weekday: "MARTES" },
  { code: "X", name: "Miércoles", weekday: "MIERCOLES" },
  { code: "J", name: "Jueves", weekday: "JUEVES" },
  { code: "V", name: "Viernes", weekday: "VIERNES" },
  { code: "S", name: "Sábado", weekday: "SABADO" },
  { code: "D", name: "Domingo", weekday: "DOMINGO" },
]

export const CODE_ORDER = daysOfWeek.map((d) => d.code)

export const WEEKDAY_TO_CODE: Record<string, string> = Object.fromEntries(
  daysOfWeek.map((d) => [d.weekday, d.code])
)

export const byWeekdayOrder = (a: string, b: string) => CODE_ORDER.indexOf(a) - CODE_ORDER.indexOf(b)
