"use client"

import { useEffect, useRef } from "react"
import { ScanLine } from "lucide-react"

interface BarcodeScannerProps {
  active: boolean
  onScan: (code: string) => void
  onError?: (kind: 'permission' | 'unavailable') => void
}

export function BarcodeScanner({ active, onScan, onError }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onScanRef = useRef(onScan)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onScanRef.current = onScan
    onErrorRef.current = onError
  })

  useEffect(() => {
    if (!active) return

    let cancelled = false
    let controls: { stop: () => void } | null = null

    const start = async () => {
      try {
        // Lazy-load zxing so it never ships in the main bundle nor runs during SSR.
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (cancelled) return
        const reader = new BrowserMultiFormatReader()
        controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current ?? undefined,
          (result) => {
            if (result) onScanRef.current(result.getText())
          }
        )
        // If the effect was torn down while awaiting, stop immediately.
        if (cancelled) {
          controls?.stop()
          controls = null
        }
      } catch (err: any) {
        if (cancelled) return
        if (err?.name === 'NotAllowedError') {
          onErrorRef.current?.('permission')
        } else {
          onErrorRef.current?.('unavailable')
        }
      }
    }

    start()

    return () => {
      cancelled = true
      try {
        controls?.stop()
      } catch {
        // ignore stop errors
      }
      const stream = videoRef.current?.srcObject as MediaStream | null
      stream?.getTracks().forEach((track) => track.stop())
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [active])

  return (
    <div className="relative flex-1 flex items-center justify-center overflow-hidden rounded-3xl bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        muted
        playsInline
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-40 w-64 rounded-2xl border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
      </div>
      <div className="pointer-events-none absolute bottom-6 left-0 right-0 flex flex-col items-center gap-2 text-white/80">
        <ScanLine className="h-5 w-5" />
        <p className="text-[11px] font-bold uppercase tracking-[0.2em]">Apuntá al código de barras</p>
      </div>
    </div>
  )
}
