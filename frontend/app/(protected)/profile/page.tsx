"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { ArrowLeft, User, Settings, Bell, Moon, LogOut, ChevronRight, Shield, Ruler, Weight, Target, Activity, Plus, Smartphone, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { userService, UserProfile } from "@/lib/api/user.service"
import { authService } from "@/lib/api/auth.service"
import { notificationService } from "@/lib/api/notification.service"
import { EditProfileSheet } from "@/components/fitness/edit-profile-sheet"
import { ErrorState } from "@/components/fitness/error-state"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export default function ProfilePage() {
  const router = useRouter()
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showEditSheet, setShowEditSheet] = useState(false)
  const [isPushSupported, setIsPushSupported] = useState(false)
  const [isSubscribing, setIsSubscribing] = useState(false)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  const fetchProfile = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await userService.getProfile()
      setUser(data)
    } catch (err) {
      console.error("Error fetching profile:", err)
      setError("No pudimos cargar tu perfil. Revisá tu conexión e intentá de nuevo.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await authService.logout()
      toast.success("Sesión cerrada")
      router.push("/login")
    } catch (error) {
      console.error("Error logging out:", error)
      toast.error("No pudimos cerrar tu sesión. Intentá de nuevo.")
    }
  }

  useEffect(() => {
    fetchProfile()

    // Check push support
    const pushAvailable = "serviceWorker" in navigator && "PushManager" in window
    setIsPushSupported(pushAvailable)

    // Check if subscribed
    if (pushAvailable) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.pushManager.getSubscription().then((subscription) => {
          setIsSubscribed(!!subscription)
        })
      })
    }

    // Check if running as standalone PWA
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone
    setIsStandalone(!!isStandaloneMode)

    // Detect iOS
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
    const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice)
  }, [])

  const handleEnableNotifications = async () => {
    console.log("Starting notification subscription process...");
    if (!isPushSupported) {
      toast.error("Tu navegador no soporta notificaciones push")
      return
    }

    setIsSubscribing(true)
    try {
      // 1. Check permission
      console.log("Requesting notification permission...");
      const permission = await Notification.requestPermission()
      console.log("Permission status:", permission);
      if (permission !== "granted") {
        toast.error("Permiso denegado. Habilita las notificaciones en ajustes de tu iPhone.")
        return
      }

      // 2. Get SW registration
      console.log("Waiting for Service Worker to be ready...");
      const registration = await navigator.serviceWorker.ready
      console.log("Service Worker ready.");

      // 3. Subscribe
      // Use VAPID public key from environment variables
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      console.log("VAPID Public Key:", publicKey ? "Found" : "NOT FOUND");

      if (!publicKey) {
        toast.error("No pudimos activar las notificaciones por un problema de configuración. Contactá a soporte.")
        return
      }

      console.log("Subscribing to Push Manager...");

      // FORCED RESET: Unsubscribe if there's an existing subscription
      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        console.log("Existing subscription found, unsubscribing for clean state...");
        await existingSub.unsubscribe();
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: notificationService.urlBase64ToUint8Array(publicKey)
      })
      console.log("Subscription obtained from browser:", !!subscription);

      // 4. Send to backend
      console.log("Sending subscription to backend...");
      await notificationService.subscribeToNotifications(subscription)
      console.log("Successfully sent to backend.");

      setIsSubscribed(true)
      toast.success("¡Notificaciones activadas!")

      // 5. Test it!
      console.log("Sending test notification...");
      await notificationService.sendTestNotification()
      console.log("Test notification sent.");
    } catch (error: any) {
      console.error("CRITICAL ERROR subscribing to push:", error)
      toast.error("No pudimos activar las notificaciones. Asegurate de que la app esté instalada e intentá de nuevo.")
    } finally {
      setIsSubscribing(false)
      console.log("Notification subscription process finished.");
    }
  }

  const handleDisableNotifications = async () => {
    console.log("Starting notification unsubscription process...");
    setIsSubscribing(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (subscription) {
        // 1. Unsubscribe from backend
        console.log("Unsubscribing from backend...");
        await notificationService.unsubscribeFromNotifications(subscription.endpoint)

        // 2. Unsubscribe from browser
        console.log("Unsubscribing from browser...");
        await subscription.unsubscribe()

        setIsSubscribed(false)
        toast.success("Notificaciones desactivadas")
      }
    } catch (error: any) {
      console.error("Error unsubscribing from push:", error)
      toast.error("No pudimos desactivar las notificaciones. Intentá de nuevo.")
    } finally {
      setIsSubscribing(false)
      console.log("Notification unsubscription process finished.");
    }
  }

  const bmi = useMemo(() => {
    if (!user?.heightCm || !user?.currentWeightKg) return null
    const heightM = user.heightCm / 100
    return (user.currentWeightKg / (heightM * heightM)).toFixed(1)
  }, [user])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="h-10 w-10 rounded-full border-2 border-t-primary border-border animate-spin mb-4" />
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Cargando Perfil</p>
      </div>
    )
  }

  if (error) {
    return <ErrorState description={error} onRetry={fetchProfile} />
  }

  return (
    <div className="lg:max-w-2xl lg:mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 px-1">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-accent">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Mi Perfil</h1>
        </div>
      </div>

      {/* Profile Card Premium */}
      <div className="bg-card rounded-[2.5rem] p-8 mb-8 border border-border shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 pointer-events-none scale-125">
          <User className="h-24 w-24 text-foreground/5" />
        </div>

        <div className="flex flex-col items-center text-center relative z-10">
          <div className="relative mb-4 group cursor-pointer" onClick={() => setShowEditSheet(true)}>
            <Avatar className="h-24 w-24 border-2 border-primary">
              <AvatarFallback className="bg-background text-primary text-3xl font-semibold uppercase">
                {user?.name?.charAt(0) || user?.email.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-primary border-2 border-background flex items-center justify-center">
              <Plus className="h-4 w-4 text-primary-foreground" />
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-foreground uppercase tracking-tight">
            {user?.name || "Fitness User"}
          </h2>
          <p className="text-primary/60 text-xs font-bold uppercase tracking-[0.2em] mt-1">
            {user?.email}
          </p>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-3 gap-4 w-full mt-8">
            <ProfileStat label="Altura" value={user?.heightCm ? `${user.heightCm}cm` : "--"} />
            <ProfileStat label="Peso" value={user?.currentWeightKg ? `${user.currentWeightKg}kg` : "--"} />
            <ProfileStat label="IMC" value={bmi || "--"} />
          </div>
        </div>
      </div>

      {/* Action Sections */}
      <div className="space-y-3">
        {/* Notification Configuration Section */}
        <div className="bg-card border border-border rounded-2xl p-5 mb-6 relative overflow-hidden">
          <Bell className="absolute -right-2 -top-2 h-16 w-16 text-foreground/5" />
          <div className="flex items-center gap-4 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center text-primary">
              <Bell className="h-5 w-5" />
            </div>
          <div>
              <p className="text-foreground font-bold text-sm">Notificaciones Push</p>
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
                {isIOS && !isStandalone ? "Requiere Instalación" : "Recordatorios y Alertas"}
              </p>
            </div>
          </div>

          {isIOS && !isStandalone ? (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 mb-2">
              <p className="text-xs text-primary font-medium leading-relaxed">
                Para activar notificaciones en iPhone, tocá <span className="bg-white/10 px-1 rounded">compartir</span> y luego <span className="bg-white/10 px-1 rounded">"Añadir a pantalla de inicio"</span>.
              </p>
            </div>
          ) : (
            <Button
              onClick={isSubscribed ? handleDisableNotifications : handleEnableNotifications}
              disabled={isSubscribing || !isPushSupported}
              className={cn(
                "w-full font-semibold uppercase text-xs tracking-widest h-10 transition-all",
                isSubscribed &&
                  "bg-success/20 text-success border border-success/30 hover:bg-destructive/20 hover:text-destructive hover:border-destructive/30"
              )}
            >
              {!isPushSupported ? "No Soportado" : isSubscribing ? "Configurando..." : isSubscribed ? "Habilitadas ✅ (Toca para desactivar)" : "Activar en este dispositivo"}
            </Button>
          )}
        </div>

        <ProfileSection
          icon={Target}
          title="Objetivo"
          value={user?.goal === 'CUT' ? 'Definición' : user?.goal === 'BULK' ? 'Volumen' : 'Mantenimiento'}
          onClick={() => setShowEditSheet(true)}
        />
        <ProfileSection
          icon={Activity}
          title="Actividad"
          value={user?.activityLevel === 'SEDENTARY' ? 'Baja' : user?.activityLevel === 'MODERATE' ? 'Moderada' : 'Alta'}
          onClick={() => setShowEditSheet(true)}
        />
        <ProfileSection icon={Shield} title="Seguridad" value="Protegida" />
      </div>

      {/* Logout */}
      <Button
        variant="ghost"
        onClick={handleLogout}
        className="w-full mt-10 h-14 text-destructive hover:text-destructive/80 hover:bg-destructive/10 justify-center font-bold uppercase tracking-widest text-xs border border-destructive/10"
      >
        <LogOut className="h-4 w-4 mr-2" />
        Cerrar Sesión Activa
      </Button>

      <EditProfileSheet
        open={showEditSheet}
        onClose={() => setShowEditSheet(false)}
        user={user}
        onSaved={fetchProfile}
      />
    </div>
  )
}

function ProfileStat({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="font-display text-2xl font-semibold text-foreground tabular-nums-data tracking-tight">{value}</span>
      <span className="text-xs font-medium uppercase text-muted-foreground tracking-widest mt-0.5">{label}</span>
    </div>
  )
}

function ProfileSection({ icon: Icon, title, value, onClick }: { icon: any, title: string, value: string, onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-card border border-border rounded-2xl p-4 flex items-center justify-between transition-all",
        onClick ? "cursor-pointer hover:bg-accent hover:border-primary/20" : "opacity-60"
      )}
    >
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest">{title}</p>
          <p className="text-foreground font-bold text-sm">{value}</p>
        </div>
      </div>
      {onClick && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
    </div>
  )
}
