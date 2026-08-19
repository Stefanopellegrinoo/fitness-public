"use client"

import { useEffect } from "react"

export function PWARegistration() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      // Register immediately, don't wait for load event which might have already passed
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("SW registrado con éxito:", registration.scope)
          
          // Check for updates periodically
          registration.update();
        })
        .catch((error) => {
          console.error("Fallo al registrar SW:", error)
        })
    }
  }, [])

  return null
}
