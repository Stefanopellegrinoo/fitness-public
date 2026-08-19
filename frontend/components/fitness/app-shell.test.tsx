import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { AppShell } from "./app-shell"

const mockPathname = vi.fn(() => "/")
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }))
vi.mock("@/lib/auth/auth.context", () => ({
  useAuth: () => ({ user: { email: "atleta@test.local" } }),
}))

describe("AppShell", () => {
  beforeEach(() => mockPathname.mockReturnValue("/"))

  it("renders both navs and children on a normal route", () => {
    render(<AppShell><p>contenido</p></AppShell>)
    expect(screen.getByText("contenido")).toBeInTheDocument()
    // Sidebar (carries the brand) + bottom-nav are both in the DOM; CSS decides which is visible.
    expect(screen.getByText("FITNESS")).toBeInTheDocument()
    expect(screen.getAllByRole("navigation")).toHaveLength(2)
  })

  it("renders only children on the immersive route", () => {
    mockPathname.mockReturnValue("/workout/active")
    render(<AppShell><p>entreno</p></AppShell>)
    expect(screen.getByText("entreno")).toBeInTheDocument()
    expect(screen.queryByText("FITNESS")).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
  })
})
