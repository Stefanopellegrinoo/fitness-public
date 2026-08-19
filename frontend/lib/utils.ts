import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Capitalizes only the first character, leaving the rest untouched (e.g.
// lowercase Spanish connectors like "de" stay lowercase). Use this instead of
// the CSS `capitalize` class on Spanish date strings — `capitalize` title-cases
// every word, turning "miércoles, 22 de julio" into "Miércoles, 22 De Julio".
export function capitalizeFirst(text: string): string {
  if (!text) return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}
