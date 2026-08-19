import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { Sidebar } from "./sidebar"

const mockPathname = vi.fn(() => "/workout")
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }))
vi.mock("@/lib/auth/auth.context", () => ({
  useAuth: () => ({ user: { email: "atleta@test.local" } }),
}))

describe("Sidebar", () => {
  beforeEach(() => mockPathname.mockReturnValue("/workout"))

  it("renders all six nav destinations with labels", () => {
    render(<Sidebar />)
    for (const label of ["Inicio", "Entrenar", "Nutrición", "Métricas", "Progreso", "Perfil"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it("marks the current route as active via aria-current", () => {
    render(<Sidebar />)
    const active = screen.getByText("Entrenar").closest("a")
    expect(active).toHaveAttribute("aria-current", "page")
  })

  it("shows the logged-in email in the footer", () => {
    render(<Sidebar />)
    expect(screen.getByText("atleta@test.local")).toBeInTheDocument()
  })
})
