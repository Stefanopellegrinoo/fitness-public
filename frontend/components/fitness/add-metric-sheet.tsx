"use client"

import { useState, useEffect } from "react"
import { X, Scale, Ruler, Activity, Save, ArrowLeft, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { metricsService } from "@/lib/api/metrics.service"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

interface AddMetricSheetProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  initialTab?: 'weight' | 'composition' | 'measurements'
}

type Tab = 'weight' | 'composition' | 'measurements'

export function AddMetricSheet({ open, onClose, onSaved, initialTab = 'weight' }: AddMetricSheetProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [isSaving, setIsSaving] = useState(false)
  const [measurementDate, setMeasurementDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [data, setData] = useState<any>({
    weightKg: "",
    muscleMassKg: "",
    fatMassKg: "",
    chestCm: "",
    waistCm: "",
    hipCm: "",
    leftArmCm: "",
    rightArmCm: "",
    leftThighCm: "",
    rightThighCm: "",
    leftCalfCm: "",
    rightCalfCm: "",
    notes: ""
  })

  // Sync activeTab with initialTab when opening
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab)
    }
  }, [open, initialTab])

  const handleInputChange = (field: string, value: string) => {
    setData((prev: any) => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    const hasData = Object.entries(data).some(([k, v]) => k !== 'notes' && v !== "")
    if (!hasData) {
      toast.error("Ingresa al menos una medición")
      return
    }

    setIsSaving(true)
    try {
      const payload: any = {
        date: new Date(measurementDate).toISOString()
      }
      Object.entries(data).forEach(([k, v]) => {
        if (v !== "") {
          payload[k] = k === 'notes' ? v : parseFloat(v as string)
        }
      })

      await metricsService.recordMetric(payload)
      toast.success("Medición registrada con éxito")
      onSaved()
      handleClose()
    } catch (error) {
      console.error("Error saving metric:", error)
      toast.error("No pudimos guardar la medición. Revisá tu conexión e intentá de nuevo.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
    onClose()
    setTimeout(() => {
      setData({
        weightKg: "",
        muscleMassKg: "",
        fatMassKg: "",
        chestCm: "",
        waistCm: "",
        hipCm: "",
        leftArmCm: "",
        rightArmCm: "",
        leftThighCm: "",
        rightThighCm: "",
        leftCalfCm: "",
        rightCalfCm: "",
        notes: ""
      })
      setMeasurementDate(format(new Date(), 'yyyy-MM-dd'))
    }, 300)
  }

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <SheetContent
        side="bottom"
        className="bg-background border-t border-border rounded-t-[2.5rem] h-[90vh] overflow-hidden flex flex-col focus:outline-none px-4"
      >
        <SheetHeader className="pb-4 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <SheetTitle className="text-foreground text-xl font-bold tracking-tight">Nueva Medición</SheetTitle>
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-widest">Registro de progreso</p>
            </div>
          </div>
        </SheetHeader>

        {/* Date Selector - COMPACT */}
        <div className="flex items-center gap-3 bg-card p-3 rounded-2xl border border-border mb-4">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Calendar className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-[9px] font-semibold uppercase text-muted-foreground tracking-widest mb-0.5">Fecha de Medición</p>
            <input
              type="date"
              value={measurementDate}
              onChange={(e) => setMeasurementDate(e.target.value)}
              className="bg-transparent border-none text-foreground font-bold text-sm focus:outline-none w-full [color-scheme:dark]"
            />
          </div>
        </div>

        {/* Custom Tabs */}
        <div className="flex bg-card p-1 rounded-2xl border border-border mb-6">
          <button
            onClick={() => setActiveTab('weight')}
            className={cn(
              "flex-1 py-3 rounded-xl flex flex-col items-center gap-1 transition-all",
              activeTab === 'weight' ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Scale className="h-4 w-4" />
            <span className="text-[10px] font-bold uppercase tracking-tighter">Peso</span>
          </button>
          <button
            onClick={() => setActiveTab('composition')}
            className={cn(
              "flex-1 py-3 rounded-xl flex flex-col items-center gap-1 transition-all",
              activeTab === 'composition' ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Activity className="h-4 w-4" />
            <span className="text-[10px] font-bold uppercase tracking-tighter">Compo</span>
          </button>
          <button
            onClick={() => setActiveTab('measurements')}
            className={cn(
              "flex-1 py-3 rounded-xl flex flex-col items-center gap-1 transition-all",
              activeTab === 'measurements' ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Ruler className="h-4 w-4" />
            <span className="text-[10px] font-bold uppercase tracking-tighter">Medidas</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-6 space-y-6">
          {activeTab === 'weight' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <MetricInputSmall
                label="Peso Corporal (kg)"
                value={data.weightKg}
                onChange={(v) => handleInputChange('weightKg', v)}
                icon={<Scale className="h-4 w-4 text-primary" />}
                placeholder="0.0"
              />
            </div>
          )}

          {activeTab === 'composition' && (
            <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom-2">
              <MetricInputSmall
                label="Músculo (kg)"
                value={data.muscleMassKg}
                onChange={(v) => handleInputChange('muscleMassKg', v)}
                icon={<Activity className="h-4 w-4 text-success" />}
                placeholder="0.0"
              />
              <MetricInputSmall
                label="Grasa (kg)"
                value={data.fatMassKg}
                onChange={(v) => handleInputChange('fatMassKg', v)}
                icon={<Activity className="h-4 w-4 text-destructive" />}
                placeholder="0.0"
              />
            </div>
          )}

          {activeTab === 'measurements' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <div className="grid grid-cols-3 gap-3">
                <MetricInputSmall label="Pecho" value={data.chestCm} onChange={(v) => handleInputChange('chestCm', v)} placeholder="cm" />
                <MetricInputSmall label="Cintura" value={data.waistCm} onChange={(v) => handleInputChange('waistCm', v)} placeholder="cm" />
                <MetricInputSmall label="Cadera" value={data.hipCm} onChange={(v) => handleInputChange('hipCm', v)} placeholder="cm" />
              </div>

              <div className="bg-white/5 h-[1px] w-full my-2" />

              <div className="grid grid-cols-2 gap-4">
                <MetricInputSmall label="Brazo Izq" value={data.leftArmCm} onChange={(v) => handleInputChange('leftArmCm', v)} placeholder="cm" />
                <MetricInputSmall label="Brazo Der" value={data.rightArmCm} onChange={(v) => handleInputChange('rightArmCm', v)} placeholder="cm" />
                <MetricInputSmall label="Muslo Izq" value={data.leftThighCm} onChange={(v) => handleInputChange('leftThighCm', v)} placeholder="cm" />
                <MetricInputSmall label="Muslo Der" value={data.rightThighCm} onChange={(v) => handleInputChange('rightThighCm', v)} placeholder="cm" />
                <MetricInputSmall label="Gemelo Izq" value={data.leftCalfCm} onChange={(v) => handleInputChange('leftCalfCm', v)} placeholder="cm" />
                <MetricInputSmall label="Gemelo Der" value={data.rightCalfCm} onChange={(v) => handleInputChange('rightCalfCm', v)} placeholder="cm" />
              </div>
            </div>
          )}

          <div className="space-y-2 px-1">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground ml-1">Notas</label>
            <textarea
              value={data.notes}
              onChange={(e) => handleInputChange('notes', e.target.value)}
              placeholder="Ej: Medición en ayunas..."
              className="w-full h-20 bg-card border border-border rounded-2xl p-4 text-foreground text-sm focus:outline-none"
            />
          </div>

          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full h-16 text-lg font-semibold uppercase tracking-tighter shadow-2xl shadow-primary/20"
          >
            {isSaving ? "Guardando..." : "Confirmar Medición"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function MetricInputSmall({ label, value, onChange, icon, placeholder }: { label: string, value: string, onChange: (v: string) => void, icon?: React.ReactNode, placeholder?: string }) {
  return (
    <div className="space-y-2 flex-1 min-w-0">
      <label className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-1.5 truncate">
        {icon}
        {label}
      </label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-12 bg-card border-border text-foreground rounded-xl text-base font-bold focus:ring-primary/20"
      />
    </div>
  )
}
