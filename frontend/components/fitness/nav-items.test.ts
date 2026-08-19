import { describe, it, expect } from "vitest"
import { navItems, isActiveRoute } from "./nav-items"

describe("navItems", () => {
  it("exposes the six destinations in order", () => {
    expect(navItems.map((i) => i.href)).toEqual([
      "/", "/workout", "/nutrition", "/metrics", "/progress", "/profile",
    ])
    expect(navItems.every((i) => i.label.length > 0 && i.icon)).toBe(true)
  })
})

describe("isActiveRoute", () => {
  it("matches the home route only exactly", () => {
    expect(isActiveRoute("/", "/")).toBe(true)
    expect(isActiveRoute("/workout", "/")).toBe(false)
  })
  it("matches an exact non-home route", () => {
    expect(isActiveRoute("/workout", "/workout")).toBe(true)
  })
  it("matches a nested route by prefix", () => {
    expect(isActiveRoute("/workout/routines/create", "/workout")).toBe(true)
  })
  it("does not match an unrelated route", () => {
    expect(isActiveRoute("/nutrition", "/workout")).toBe(false)
  })
})
