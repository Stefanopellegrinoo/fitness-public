import { Home, Dumbbell, Utensils, Scale, TrendingUp, User, type LucideIcon } from "lucide-react"

export interface NavItem {
  href: string
  icon: LucideIcon
  label: string
}

export const navItems: NavItem[] = [
  { href: "/", icon: Home, label: "Inicio" },
  { href: "/workout", icon: Dumbbell, label: "Entrenar" },
  { href: "/nutrition", icon: Utensils, label: "Nutrición" },
  { href: "/metrics", icon: Scale, label: "Métricas" },
  { href: "/progress", icon: TrendingUp, label: "Progreso" },
  { href: "/profile", icon: User, label: "Perfil" },
]

// Home matches only on exact path; every other route matches its own path or any nested child.
export function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(href))
}
