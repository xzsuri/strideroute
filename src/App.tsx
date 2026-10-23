import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Navigation,
  AlertTriangle,
  Coffee,
  Building2,
  Sparkles,
  ArrowLeft,
  SlidersHorizontal,
  LocateFixed,
  Check,
  X,
  Moon,
  Sun,
  Clock,
  Bell,
  BellRing,
  Volume2,
  VolumeX,
  Download,
  Car,
  PictureInPicture2,
  Maximize2,
  CornerDownRight,
} from 'lucide-react';
import {
  ComputedRouteOption,
  DailyRoutineRule,
  GeoLocation,
  LivePlace,
  RoutineTimeSlot,
} from './types/commute';
import { CommuteMapCanvas } from './components/CommuteMapCanvas';
import { PlaceSearchInput } from './components/PlaceSearchInput';
import { usePWAInstall } from './hooks/usePWAInstall';
import {
  ensureServiceWorkerRegistered,
  requestNotificationPermissionIfNeeded,
  stopDrivingSpeech,
  triggerDrivingNotification,
} from './utils/drivingNotifier';
import { drawRouteToPipCanvas } from './utils/pipCanvasStream';

const DEFAULT_COORDS: GeoLocation = {
  lat: 37.7858,
  lng: -122.4065,
};

interface TimeSlotConfig {
  slot: RoutineTimeSlot;
  headingTitle: string;
  pitstopQuestion: string;
  directQuestion: string;
  destinationRoleLabel: string;
  pitstopRoleLabel: string;
  newSuggestionPrompt: string;
  defaultSearchCategory: string;
}

const TIME_SLOT_CONFIGS: Record<RoutineTimeSlot, TimeSlotConfig> = {
  MORNING: {
    slot: 'MORNING',
    headingTitle: 'Heading to office',
    pitstopQuestion: 'Go to restaurant?',
    directQuestion: 'Go directly to office?',
    destinationRoleLabel: 'Office',
    pitstopRoleLabel: 'Breakfast restaurant',
    newSuggestionPrompt: 'Suggest a new breakfast place instead',
    defaultSearchCategory: 'breakfast_restaurant',
  },
  MIDDAY: {
    slot: 'MIDDAY',
    headingTitle: 'Heading for lunch break',
    pitstopQuestion: 'Stop by coffee shop first?',
    directQuestion: 'Go directly to lunch spot?',
    destinationRoleLabel: 'Lunch / Midday Destination',
    pitstopRoleLabel: 'Coffee / Cafe Stop',
    newSuggestionPrompt: 'Suggest a new cafe or lunch spot instead',
    defaultSearchCategory: 'cafe',
  },
  EVENING: {
    slot: 'EVENING',
    headingTitle: 'Heading home',
    pitstopQuestion: 'Stop by grocery / dinner spot?',
    directQuestion: 'Go directly home?',
    destinationRoleLabel: 'Home',
    pitstopRoleLabel: 'Evening Stop (Grocery / Dinner)',
    newSuggestionPrompt: 'Suggest a new evening stop instead',
    defaultSearchCategory: 'supermarket',
  },
};

const INITIAL_ROUTINES: Record<RoutineTimeSlot, DailyRoutineRule> = {
  MORNING: {
    id: 'routine-morning',
    timeSlot: 'MORNING',
    windowStart: '05:00',
    windowEnd: '11:59',
    label: 'Morning Routine',
    pitstopCategory: 'breakfast_restaurant',
    preferredPitstop: null,
    destination: null,
    visitFrequencyDays: 18,
    includePitstopInRoute: true,
  },
  MIDDAY: {
    id: 'routine-midday',
    timeSlot: 'MIDDAY',
    windowStart: '12:00',
    windowEnd: '16:59',
    label: 'Afternoon Routine',
    pitstopCategory: 'cafe',
    preferredPitstop: null,
    destination: null,
    visitFrequencyDays: 12,
    includePitstopInRoute: true,
  },
  EVENING: {
    id: 'routine-evening',
    timeSlot: 'EVENING',
    windowStart: '17:00',
    windowEnd: '04:59',
    label: 'Evening Routine',
    pitstopCategory: 'supermarket',
    preferredPitstop: null,
    destination: null,
    visitFrequencyDays: 15,
    includePitstopInRoute: true,
  },
};

function detectSlotFromHour(hour: number): RoutineTimeSlot {
  if (hour >= 5 && hour < 12) return 'MORNING';
  if (hour >= 12 && hour < 17) return 'MIDDAY';
  return 'EVENING';
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(millis: number): string {
  const mins = Math.max(1, Math.round(millis / 60000));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs} hr ${rem} min` : `${hrs} hr`;
}

export default function App() {
  // PWA Install Hook
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [showIOSInstallModal, setShowIOSInstallModal] = useState(false);

  // Dark Mode State (persisted to localStorage, defaults to true)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('strideroute_dark_mode');
      if (saved !== null) return saved === 'true';
    } catch {
      // ignore
    }
    return true;
  });

  useEffect(() => {
    try {
      localStorage.setItem('strideroute_dark_mode', String(isDarkMode));
    } catch {
      // ignore
    }
  }, [isDarkMode]);

  // Live Clock & Time-of-Day Mode
  const [now, setNow] = useState<Date>(() => new Date());
  const [timeMode, setTimeMode] = useState<'AUTO' | RoutineTimeSlot>('AUTO');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const activeSlot: RoutineTimeSlot = useMemo(() => {
    if (timeMode !== 'AUTO') return timeMode;
    return detectSlotFromHour(now.getHours());
  }, [timeMode, now]);

  const currentConfig = TIME_SLOT_CONFIGS[activeSlot];

  const formattedClock = useMemo(() => {
    if (timeMode === 'MORNING') return '08:30 AM (Morning)';
    if (timeMode === 'MIDDAY') return '01:00 PM (Afternoon)';
    if (timeMode === 'EVENING') return '06:30 PM (Evening)';
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [timeMode, now]);

  // Screen Modes:
  // 'prompt' = Simple "Heading to office" screen
  // 'route'  = Active shortest route & live traffic directions
  // 'lockscreen' = Simulated "App Closed / Driving Detected" Android Lock-Screen Notification
  const [screenMode, setScreenMode] = useState<'prompt' | 'route' | 'lockscreen'>('prompt');
  const [isPipMode, setIsPipMode] = useState<boolean>(false);
  const [pipCorner, setPipCorner] = useState<
    'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  >('bottom-right');
  const [showNewPlacesList, setShowNewPlacesList] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);

  // Refs for optional OS-level Picture-in-Picture video stream
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);

  // Background Driving Alert & Voice Readout Settings (Voice off by default so tab switches are silent)
  const [bgAlertsEnabled, setBgAlertsEnabled] = useState<boolean>(true);
  const [voiceAlertsEnabled, setVoiceAlertsEnabled] = useState<boolean>(false);
  const [drivingSpeedKmh, setDrivingSpeedKmh] = useState<number>(0);

  // Clear any stuck browser speech synthesis immediately on mount
  useEffect(() => {
    stopDrivingSpeech();
    return () => stopDrivingSpeech();
  }, []);

  // Live Location & Driving Speed Tracking
  const [userLocation, setUserLocation] = useState<GeoLocation>(DEFAULT_COORDS);
  const [isTrackingGps, setIsTrackingGps] = useState<boolean>(true);
  const [gpsLabel, setGpsLabel] = useState<string>('Tracking location');
  const lastNotifiedSlotRef = useRef<string | null>(null);
  const lastHiddenNotifiedSlotRef = useRef<string | null>(null);

  // Routines State per Time Slot
  const [routinesBySlot, setRoutinesBySlot] = useState<Record<RoutineTimeSlot, DailyRoutineRule>>(
    () => {
      try {
        const saved = localStorage.getItem('strideroute_time_routines_v1');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.MORNING && parsed.MIDDAY && parsed.EVENING) {
            return parsed;
          }
        }
      } catch {
        // ignore storage errors
      }
      return INITIAL_ROUTINES;
    }
  );

  useEffect(() => {
    try {
      localStorage.setItem('strideroute_time_routines_v1', JSON.stringify(routinesBySlot));
    } catch {
      // ignore
    }
  }, [routinesBySlot]);

  const routine = routinesBySlot[activeSlot];

  const updateCurrentRoutine = useCallback(
    (updater: (prev: DailyRoutineRule) => DailyRoutineRule) => {
      setRoutinesBySlot((prev) => ({
        ...prev,
        [activeSlot]: updater(prev[activeSlot]),
      }));
    },
    [activeSlot]
  );

  // Computed Routes & Nearby Suggestions
  const [computedRoutes, setComputedRoutes] = useState<ComputedRouteOption[]>([]);
  const [isComputingRoutes, setIsComputingRoutes] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0);
  const [nearbySuggestions, setNearbySuggestions] = useState<LivePlace[]>([]);
  const [isLoadingNearby, setIsLoadingNearby] = useState<boolean>(false);

  const selectedRoute = useMemo(
    () =>
      computedRoutes.find((r) => r.index === selectedRouteIndex) ||
      computedRoutes[0] ||
      null,
    [computedRoutes, selectedRouteIndex]
  );

  // Keep offscreen PiP canvas updated whenever route or location changes
  useEffect(() => {
    if (!pipCanvasRef.current) return;
    drawRouteToPipCanvas(
      pipCanvasRef.current,
      userLocation,
      routine,
      selectedRoute,
      currentConfig.headingTitle
    );
  }, [userLocation, routine, selectedRoute, currentConfig.headingTitle]);

  // Build notification payload for current time slot & route
  const buildDrivingNotificationPayload = useCallback(() => {
    const pitstopName = routine.preferredPitstop?.displayName || currentConfig.pitstopRoleLabel;
    const destName = routine.destination?.displayName || currentConfig.destinationRoleLabel;
    const routeSummary = selectedRoute
      ? `${formatDistance(selectedRoute.distanceMeters)} · ${formatDuration(
          selectedRoute.durationMillis
        )} (${
          selectedRoute.trafficCondition === 'HEAVY'
            ? 'Heavy traffic'
            : selectedRoute.trafficCondition === 'MODERATE'
            ? 'Moderate traffic'
            : 'Clear traffic'
        })`
      : 'Shortest route ready';

    return {
      title: `${currentConfig.headingTitle} (${destName})`,
      body: `Stop at ${pitstopName} first, or go directly to ${destName}? · ${routeSummary}`,
      pitstopQuestion: currentConfig.pitstopQuestion,
      directQuestion: currentConfig.directQuestion,
      voiceText: `${currentConfig.headingTitle}. Would you like to ${currentConfig.pitstopQuestion.replace(
        '?',
        ''
      )} at ${pitstopName}, or ${currentConfig.directQuestion.replace('?', '')}?`,
    };
  }, [routine, currentConfig, selectedRoute]);

  const payloadBuilderRef = useRef(buildDrivingNotificationPayload);
  useEffect(() => {
    payloadBuilderRef.current = buildDrivingNotificationPayload;
  }, [buildDrivingNotificationPayload]);

  // Register Service Worker & Listen for Notification Action Clicks when app is opened from background
  useEffect(() => {
    ensureServiceWorkerRegistered();

    // Check URL query param if launched from closed state via notification action
    const params = new URLSearchParams(window.location.search);
    const commuteAction = params.get('commuteAction');
    if (commuteAction === 'pitstop') {
      updateCurrentRoutine((prev) => ({ ...prev, includePitstopInRoute: true }));
      setScreenMode('route');
      window.history.replaceState({}, '', '/');
    } else if (commuteAction === 'direct') {
      updateCurrentRoutine((prev) => ({ ...prev, includePitstopInRoute: false }));
      setScreenMode('route');
      window.history.replaceState({}, '', '/');
    }

    if ('serviceWorker' in navigator) {
      const handleSwMessage = (event: MessageEvent) => {
        if (event.data?.type === 'NOTIFICATION_ACTION_SELECTED') {
          if (event.data.action === 'direct') {
            updateCurrentRoutine((prev) => ({ ...prev, includePitstopInRoute: false }));
          } else {
            updateCurrentRoutine((prev) => ({ ...prev, includePitstopInRoute: true }));
          }
          setIsPipMode(false);
          setScreenMode('route');
        }
      };
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
      return () => navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    }
  }, [updateCurrentRoutine]);

  // Automatically enter Map-Only PiP mode when app is minimized/backgrounded (without looping TTS on tab switches)
  useEffect(() => {
    const handleVisibilityChange = () => {
      // Always cancel any active speech when switching tabs so TTS never loops
      stopDrivingSpeech();

      if (document.visibilityState === 'hidden') {
        setIsPipMode(true);
        if (bgAlertsEnabled && lastHiddenNotifiedSlotRef.current !== activeSlot) {
          lastHiddenNotifiedSlotRef.current = activeSlot;
          // Send silent system notification on tab hide (false = never speak TTS on tab switch)
          triggerDrivingNotification(payloadBuilderRef.current(), false);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [bgAlertsEnabled, activeSlot]);

  // Continuous GPS & Driving Speed Detection + Screen WakeLock for in-car mounting
  useEffect(() => {
    if (!isTrackingGps || !('geolocation' in navigator)) return;

    let wakeLockSentinel: any = null;
    if ('wakeLock' in navigator) {
      (navigator as any).wakeLock
        .request('screen')
        .then((s: any) => {
          wakeLockSentinel = s;
        })
        .catch(() => {
          // ignore if wakeLock is blocked by iframe policy
        });
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const nextLat = pos.coords.latitude;
        const nextLng = pos.coords.longitude;
        setUserLocation((prev) => {
          const dLat = Math.abs(nextLat - prev.lat);
          const dLng = Math.abs(nextLng - prev.lng);
          // Ignore sub-15m GPS sensor noise to prevent marker/map twitching on mobile
          if (dLat < 0.00014 && dLng < 0.00014) {
            return prev;
          }
          return { lat: nextLat, lng: nextLng };
        });
        const speedMs = pos.coords.speed ?? 0;
        const speedKmh = Math.max(0, Math.round(speedMs * 3.6));
        setDrivingSpeedKmh((prev) => (Math.abs(prev - speedKmh) >= 2 ? speedKmh : prev));
        setGpsLabel(speedKmh > 10 ? `Driving (${speedKmh} km/h)` : 'Live GPS active');

        // If driving speed (> 12 km/h) is detected for this time slot, notify once per slot
        if (
          speedKmh >= 12 &&
          bgAlertsEnabled &&
          lastNotifiedSlotRef.current !== activeSlot
        ) {
          lastNotifiedSlotRef.current = activeSlot;
          triggerDrivingNotification(payloadBuilderRef.current(), voiceAlertsEnabled);
        }
      },
      () => {
        setGpsLabel('Location active');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (wakeLockSentinel && typeof wakeLockSentinel.release === 'function') {
        wakeLockSentinel.release().catch(() => {});
      }
    };
  }, [isTrackingGps, bgAlertsEnabled, voiceAlertsEnabled, activeSlot]);

  const alternativeNewPlaces = useMemo(
    () =>
      nearbySuggestions.filter(
        (p) =>
          p.placeId !== routine.preferredPitstop?.placeId &&
          p.placeId !== routine.destination?.placeId
      ),
    [nearbySuggestions, routine.preferredPitstop?.placeId, routine.destination?.placeId]
  );

  const handleRoutesComputed = useCallback(
    (routes: ComputedRouteOption[], isLoading: boolean, error: string | null) => {
      setComputedRoutes(routes);
      setIsComputingRoutes(isLoading);
      setRouteError(error);
    },
    []
  );

  const handleNearbySuggestionsLoaded = useCallback(
    (places: LivePlace[], isLoading: boolean) => {
      setNearbySuggestions(places);
      setIsLoadingNearby(isLoading);
    },
    []
  );

  const handleAutoSeedRoutinePlaces = useCallback(
    (pitstop: LivePlace | null, destination: LivePlace | null) => {
      updateCurrentRoutine((prev) => ({
        ...prev,
        preferredPitstop: pitstop || prev.preferredPitstop,
        destination: destination || prev.destination,
      }));
    },
    [updateCurrentRoutine]
  );

  const handleChooseGoToPitstop = () => {
    updateCurrentRoutine((prev) => ({ ...prev, includePitstopInRoute: true }));
    setScreenMode('route');
  };

  const handleChooseGoDirectly = () => {
    updateCurrentRoutine((prev) => ({ ...prev, includePitstopInRoute: false }));
    setScreenMode('route');
  };

  const handleSelectNewPlace = (place: LivePlace) => {
    updateCurrentRoutine((prev) => ({
      ...prev,
      preferredPitstop: place,
      includePitstopInRoute: true,
    }));
    setShowNewPlacesList(false);
    setScreenMode('route');
  };

  const handleSetDestination = useCallback(
    (place: LivePlace) => {
      updateCurrentRoutine((prev) => ({ ...prev, destination: place }));
    },
    [updateCurrentRoutine]
  );

  const handleSetPitstop = useCallback(
    (place: LivePlace) => {
      updateCurrentRoutine((prev) => ({ ...prev, preferredPitstop: place }));
    },
    [updateCurrentRoutine]
  );

  const handleEnableBackgroundAlerts = async () => {
    const nextState = !bgAlertsEnabled;
    setBgAlertsEnabled(nextState);
    if (nextState) {
      await requestNotificationPermissionIfNeeded();
    }
  };

  const handleTestClosedAppDrivingAlert = async () => {
    setIsPipMode(false);
    setDrivingSpeedKmh(42);
    setScreenMode('lockscreen');
    await triggerDrivingNotification(payloadBuilderRef.current(), voiceAlertsEnabled, {
      isManualTest: true,
    });
  };

  const handleCyclePipCorner = () => {
    const order: Array<'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'> = [
      'bottom-right',
      'bottom-left',
      'top-left',
      'top-right',
    ];
    setPipCorner((prev) => order[(order.indexOf(prev) + 1) % order.length]);
  };

  const handleLaunchOsVideoPip = async () => {
    try {
      const canvas = pipCanvasRef.current;
      const video = pipVideoRef.current;
      if (!canvas || !video) return;
      drawRouteToPipCanvas(
        canvas,
        userLocation,
        routine,
        selectedRoute,
        currentConfig.headingTitle
      );
      if (!video.srcObject && typeof (canvas as any).captureStream === 'function') {
        video.srcObject = (canvas as any).captureStream(15);
      }
      await video.play();
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (typeof (video as any).requestPictureInPicture === 'function') {
        await (video as any).requestPictureInPicture();
      }
    } catch {
      // Fallback to in-app floating PiP window if browser blocks native video PiP
      setIsPipMode(true);
    }
  };

  const pipPositionClasses = useMemo(() => {
    switch (pipCorner) {
      case 'bottom-left':
        return 'bottom-5 left-5';
      case 'top-left':
        return 'top-16 left-5';
      case 'top-right':
        return 'top-16 right-5';
      case 'bottom-right':
      default:
        return 'bottom-5 right-5';
    }
  }, [pipCorner]);

  return (
    <div
      className={`min-h-screen flex flex-col transition-colors duration-200 ${
        isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-white text-slate-900'
      }`}
    >
      {/* Hidden Canvas & Video for Native OS-Level Picture-in-Picture Stream */}
      <canvas
        ref={pipCanvasRef}
        width={420}
        height={260}
        className="sr-only pointer-events-none"
      />
      <video
        ref={pipVideoRef}
        muted
        playsInline
        className="sr-only pointer-events-none"
      />

      {/* Minimal Top Bar */}
      <header className="w-full max-w-xl mx-auto px-4 pt-4 pb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setIsTrackingGps((prev) => !prev)}
              className={`min-h-[40px] px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors ${
                isDarkMode
                  ? 'text-slate-300 hover:bg-slate-900'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
              title="Toggle live location tracking"
            >
              <LocateFixed
                className={`w-3.5 h-3.5 ${
                  isTrackingGps ? 'text-blue-500' : 'text-slate-500'
                }`}
              />
              <span className="truncate max-w-[110px]">
                {isTrackingGps ? gpsLabel : 'Location paused'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleEnableBackgroundAlerts}
              className={`min-h-[40px] px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors ${
                bgAlertsEnabled
                  ? isDarkMode
                    ? 'text-emerald-400 hover:bg-slate-900'
                    : 'text-emerald-700 hover:bg-slate-100'
                  : 'text-slate-500 hover:bg-slate-900/50'
              }`}
              title="Notify when driving with app closed/backgrounded"
            >
              {bgAlertsEnabled ? (
                <BellRing className="w-3.5 h-3.5" />
              ) : (
                <Bell className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {bgAlertsEnabled ? 'Drive Alerts On' : 'Alerts Off'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setVoiceAlertsEnabled((prev) => {
                  const next = !prev;
                  if (!next) {
                    stopDrivingSpeech();
                  }
                  return next;
                });
              }}
              className={`min-h-[40px] px-2 py-1 rounded-lg flex items-center gap-1 transition-colors ${
                voiceAlertsEnabled
                  ? isDarkMode
                    ? 'text-blue-400 hover:bg-slate-900'
                    : 'text-blue-600 hover:bg-slate-100'
                  : 'text-slate-500'
              }`}
              title="Toggle voice announcement while driving"
              aria-label="Toggle voice announcement while driving"
            >
              {voiceAlertsEnabled ? (
                <Volume2 className="w-3.5 h-3.5" />
              ) : (
                <VolumeX className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setIsPipMode((prev) => !prev)}
              className={`min-h-[38px] px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                isPipMode
                  ? 'bg-blue-600 text-white'
                  : isDarkMode
                  ? 'text-slate-300 hover:bg-slate-900 border border-slate-800'
                  : 'text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
              title="Minimize app to Picture-in-Picture Map Route"
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
              <span>{isPipMode ? 'Exit PiP' : 'PiP Map'}</span>
            </button>

            {!isInstalled && (
              <button
                type="button"
                onClick={() => {
                  if (isInstallable) {
                    install();
                  } else {
                    setShowIOSInstallModal(true);
                  }
                }}
                className="min-h-[38px] px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-medium flex items-center gap-1 hover:bg-blue-500 transition-colors"
                title="Install StrideRoute on your phone"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Install</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsDarkMode((prev) => !prev)}
              aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className={`min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors ${
                isDarkMode
                  ? 'text-slate-300 hover:bg-slate-900'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {isDarkMode ? (
                <Sun className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-slate-600" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowSetupModal(true)}
              className={`min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                isDarkMode
                  ? 'text-slate-300 hover:bg-slate-900'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Locations</span>
            </button>
          </div>
        </header>

        {/* MINIMIZED APP BACKDROP WHEN IN PICTURE-IN-PICTURE (PiP) MODE */}
        {isPipMode && (
          <main className="flex-1 w-full max-w-md mx-auto px-6 flex flex-col items-center justify-center text-center pb-24">
            <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">
              App Minimized · Picture-in-Picture Active
            </div>
            <div className="text-4xl font-bold font-mono tabular-nums tracking-tight mb-2">
              {formattedClock.split(' ')[0]}
            </div>
            <p className="text-xs text-slate-400 max-w-xs mb-6">
              Showing only the live map route in the floating PiP window while the app is minimized.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsPipMode(false)}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Restore Full App</span>
              </button>
              <button
                type="button"
                onClick={handleLaunchOsVideoPip}
                className={`min-h-[42px] px-3.5 py-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  isDarkMode
                    ? 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <PictureInPicture2 className="w-3.5 h-3.5 text-blue-500" />
                <span>Pop-Out OS PiP Window</span>
              </button>
            </div>
          </main>
        )}

        {/* SCREEN 0: SIMULATED CLOSED-APP / ANDROID LOCK-SCREEN DRIVING NOTIFICATION */}
        {!isPipMode && screenMode === 'lockscreen' && (
          <main className="flex-1 w-full max-w-md mx-auto px-5 flex flex-col justify-between py-10">
            {/* Android Lock Screen Clock */}
            <div className="text-center pt-4">
              <div className="text-xs uppercase tracking-widest text-slate-500 mb-1">
                Android Lock Screen · Driving Detected ({drivingSpeedKmh || 42} km/h)
              </div>
              <div className="text-5xl font-bold font-mono tabular-nums tracking-tight">
                {formattedClock.split(' ')[0]}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                App is closed · Background GPS & Time Tracker Active
              </div>
            </div>

            {/* Heads-Up Driving Notification Card */}
            <div
              className={`rounded-3xl border p-5 shadow-2xl space-y-4 ${
                isDarkMode
                  ? 'bg-slate-900/95 border-slate-700 text-slate-100'
                  : 'bg-white border-slate-200 text-slate-900'
              }`}
            >
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5 font-medium text-blue-400">
                  <Car className="w-3.5 h-3.5" />
                  <span>StrideRoute · Driving Now</span>
                </span>
                <span>now</span>
              </div>

              <div>
                <h2 className="text-xl font-bold font-display">
                  {currentConfig.headingTitle}
                </h2>
                <p className={`text-xs mt-1 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                  {routine.preferredPitstop
                    ? `Stop at ${routine.preferredPitstop.displayName} first, or head straight to ${
                        routine.destination?.displayName || currentConfig.destinationRoleLabel
                      }?`
                    : `Choose where to head right now:`}
                </p>
                {selectedRoute && (
                  <p className="text-xs text-slate-400 mt-1 font-mono tabular-nums">
                    Shortest route: {formatDistance(selectedRoute.distanceMeters)} ·{' '}
                    {formatDuration(selectedRoute.durationMillis)} (
                    {selectedRoute.trafficCondition === 'HEAVY'
                      ? 'Heavy traffic'
                      : 'Clear traffic'}
                    )
                  </p>
                )}
              </div>

              {/* Notification Action Buttons */}
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleChooseGoToPitstop}
                  className="min-h-[48px] px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold text-center transition-colors"
                >
                  {currentConfig.pitstopQuestion}
                </button>
                <button
                  type="button"
                  onClick={handleChooseGoDirectly}
                  className={`min-h-[48px] px-3 py-2.5 rounded-xl border text-xs font-semibold text-center transition-colors ${
                    isDarkMode
                      ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-100'
                      : 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-900'
                  }`}
                >
                  {currentConfig.directQuestion}
                </button>
              </div>
            </div>

            <div className="text-center flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setIsPipMode(true)}
                className="min-h-[44px] px-4 py-2 text-xs font-medium text-blue-400 hover:text-blue-300 underline"
              >
                Open Floating PiP Map
              </button>
              <button
                type="button"
                onClick={() => setScreenMode('prompt')}
                className="min-h-[44px] px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 underline"
              >
                Return to App Screen
              </button>
            </div>
          </main>
        )}

        {/* SCREEN 1: SIMPLE ANDROID PROMPT (Dynamic Title by Time of Day) */}
        {!isPipMode && screenMode === 'prompt' && (
          <main className="flex-1 w-full max-w-md mx-auto px-6 flex flex-col justify-center pb-12">
            {/* Time-of-Day Switcher & Live Clock */}
            <div className="flex flex-col items-center mb-8">
              <div
                className={`inline-flex items-center gap-1 p-1 rounded-xl mb-4 text-xs ${
                  isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-slate-100'
                }`}
              >
                {(
                  [
                    { id: 'AUTO', label: 'Live Time' },
                    { id: 'MORNING', label: 'Morning' },
                    { id: 'MIDDAY', label: 'Afternoon' },
                    { id: 'EVENING', label: 'Evening' },
                  ] as const
                ).map((item) => {
                  const isActive = timeMode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTimeMode(item.id)}
                      className={`min-h-[32px] px-2.5 py-1 rounded-lg font-medium transition-colors whitespace-nowrap ${
                        isActive
                          ? isDarkMode
                            ? 'bg-slate-800 text-white shadow-xs'
                            : 'bg-white text-slate-900 shadow-xs'
                          : isDarkMode
                          ? 'text-slate-400 hover:text-slate-200'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-slate-400 flex items-center gap-1.5 mb-2 font-mono tabular-nums">
                <Clock className="w-3.5 h-3.5 text-blue-500" />
                <span>{formattedClock}</span>
              </p>

              {/* Dynamic Title that changes with respect to time */}
              <h1
                className={`text-3xl sm:text-4xl font-bold tracking-tight text-center font-display ${
                  isDarkMode ? 'text-white' : 'text-slate-900'
                }`}
              >
                {currentConfig.headingTitle}
              </h1>

              {routine.destination && (
                <p
                  className={`text-sm mt-1.5 text-center truncate max-w-full ${
                    isDarkMode ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  {routine.destination.displayName}
                </p>
              )}
            </div>

            {/* Two Simple Choices */}
            <div className="space-y-4">
              {/* Choice 1: Go to restaurant / cafe / grocery? */}
              <button
                type="button"
                onClick={handleChooseGoToPitstop}
                className={`w-full min-h-[76px] p-5 rounded-2xl border text-left transition-all flex items-center justify-between gap-4 group ${
                  isDarkMode
                    ? 'border-slate-800 bg-slate-900/80 hover:border-blue-500 hover:bg-slate-900'
                    : 'border-slate-200 bg-white hover:border-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="min-w-0">
                  <div
                    className={`text-lg font-semibold transition-colors ${
                      isDarkMode
                        ? 'text-slate-100 group-hover:text-blue-400'
                        : 'text-slate-900 group-hover:text-blue-600'
                    }`}
                  >
                    {currentConfig.pitstopQuestion}
                  </div>
                  <div
                    className={`text-xs mt-1 truncate ${
                      isDarkMode ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    {routine.preferredPitstop
                      ? `Usual stop: ${routine.preferredPitstop.displayName}`
                      : `Finding nearby ${currentConfig.pitstopRoleLabel.toLowerCase()}...`}
                  </div>
                </div>
                <Coffee
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    isDarkMode
                      ? 'text-slate-500 group-hover:text-blue-400'
                      : 'text-slate-400 group-hover:text-blue-600'
                  }`}
                />
              </button>

              {/* Choice 2: Go directly to destination? */}
              <button
                type="button"
                onClick={handleChooseGoDirectly}
                className={`w-full min-h-[76px] p-5 rounded-2xl border text-left transition-all flex items-center justify-between gap-4 group ${
                  isDarkMode
                    ? 'border-slate-800 bg-slate-900/80 hover:border-blue-500 hover:bg-slate-900'
                    : 'border-slate-200 bg-white hover:border-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="min-w-0">
                  <div
                    className={`text-lg font-semibold transition-colors ${
                      isDarkMode
                        ? 'text-slate-100 group-hover:text-blue-400'
                        : 'text-slate-900 group-hover:text-blue-600'
                    }`}
                  >
                    {currentConfig.directQuestion}
                  </div>
                  <div
                    className={`text-xs mt-1 truncate ${
                      isDarkMode ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    {routine.destination
                      ? `Shortest route to ${routine.destination.displayName}`
                      : `Direct shortest route to ${currentConfig.destinationRoleLabel.toLowerCase()}`}
                  </div>
                </div>
                <Building2
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    isDarkMode
                      ? 'text-slate-500 group-hover:text-blue-400'
                      : 'text-slate-400 group-hover:text-blue-600'
                  }`}
                />
              </button>
            </div>

            {/* Subtle Real-Time Traffic Status, New Places & Closed-App Driving Notification Test */}
            <div
              className={`mt-8 pt-6 border-t space-y-3 ${
                isDarkMode ? 'border-slate-800/80' : 'border-slate-100'
              }`}
            >
              {selectedRoute && (
                <div
                  className={`flex items-center justify-between text-xs ${
                    isDarkMode ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {selectedRoute.trafficCondition === 'HEAVY' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    ) : (
                      <Navigation className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    )}
                    {selectedRoute.trafficCondition === 'HEAVY'
                      ? `Heavy traffic (+${selectedRoute.trafficDelayMinutes} min delay)`
                      : selectedRoute.trafficCondition === 'MODERATE'
                      ? `Moderate traffic (+${selectedRoute.trafficDelayMinutes} min)`
                      : 'Traffic is clear right now'}
                  </span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {formatDistance(selectedRoute.distanceMeters)} ·{' '}
                    {formatDuration(selectedRoute.durationMillis)}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewPlacesList((prev) => !prev)}
                  className={`min-h-[40px] text-xs font-medium flex items-center gap-1.5 ${
                    isDarkMode
                      ? 'text-blue-400 hover:text-blue-300'
                      : 'text-blue-600 hover:text-blue-800'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {showNewPlacesList
                      ? 'Hide suggestions'
                      : currentConfig.newSuggestionPrompt}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleTestClosedAppDrivingAlert}
                  className={`min-h-[40px] px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    isDarkMode
                      ? 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Car className="w-3.5 h-3.5 text-blue-500" />
                  <span>Test Closed-App Drive Alert</span>
                </button>
              </div>

              {showNewPlacesList && (
                <div
                  className={`mt-2 divide-y border rounded-2xl p-3 ${
                    isDarkMode
                      ? 'divide-slate-800 border-slate-800 bg-slate-900/70'
                      : 'divide-slate-100 border-slate-200 bg-slate-50/50'
                  }`}
                >
                  {isLoadingNearby ? (
                    <div className="py-3 text-xs text-slate-500">
                      Finding nearby places...
                    </div>
                  ) : alternativeNewPlaces.length === 0 ? (
                    <div className="py-3 text-xs text-slate-500">
                      No other nearby places found right now.
                    </div>
                  ) : (
                    alternativeNewPlaces.slice(0, 4).map((place) => (
                      <button
                        key={place.placeId}
                        type="button"
                        onClick={() => handleSelectNewPlace(place)}
                        className="w-full py-2.5 first:pt-1 last:pb-1 text-left flex items-center justify-between gap-3 group transition-colors"
                      >
                        <div className="min-w-0">
                          <div
                            className={`text-sm font-medium truncate ${
                              isDarkMode
                                ? 'text-slate-100 group-hover:text-blue-400'
                                : 'text-slate-900 group-hover:text-blue-600'
                            }`}
                          >
                            {place.displayName}
                          </div>
                          <div
                            className={`text-xs truncate ${
                              isDarkMode ? 'text-slate-400' : 'text-slate-500'
                            }`}
                          >
                            {place.rating ? `${place.rating.toFixed(1)} ★ · ` : ''}
                            {place.formattedAddress}
                          </div>
                        </div>
                        <span
                          className={`text-xs font-semibold shrink-0 ${
                            isDarkMode ? 'text-blue-400' : 'text-blue-600'
                          }`}
                        >
                          Go here
                        </span>
                      </button>
                    ))
                  )}
                  <div className="pt-1.5 text-[10px] text-slate-500 text-right">
                    OpenStreetMap
                  </div>
                </div>
              )}
            </div>
          </main>
        )}

        {/* SCREEN 2: ACTIVE SHORTEST ROUTE, LIVE TRAFFIC & DIRECTIONS (+ FLOATING PiP MAP WHEN MINIMIZED) */}
        <div
          className={
            isPipMode
              ? 'contents'
              : screenMode === 'route'
              ? 'flex-1 w-full max-w-xl mx-auto px-4 pb-8 flex flex-col gap-4'
              : 'fixed -left-[9999px] top-0 w-[380px] h-[380px] opacity-0 pointer-events-none overflow-hidden'
          }
        >
          {/* Back button & current route header (hidden in PiP map-only mode) */}
          {!isPipMode && (
            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => setScreenMode('prompt')}
                className={`min-h-[44px] px-3 py-2 -ml-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-colors ${
                  isDarkMode
                    ? 'text-slate-200 hover:bg-slate-900'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPipMode(true)}
                  className={`min-h-[34px] px-2.5 py-1 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    isDarkMode
                      ? 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                  title="Minimize to Map-Only Picture-in-Picture"
                >
                  <PictureInPicture2 className="w-3.5 h-3.5 text-blue-500" />
                  <span>Minimize to PiP</span>
                </button>

                <div
                  className={`flex items-center gap-1 p-1 rounded-xl ${
                    isDarkMode ? 'bg-slate-900' : 'bg-slate-100'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      updateCurrentRoutine((prev) => ({ ...prev, includePitstopInRoute: true }))
                    }
                    className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                      routine.includePitstopInRoute
                        ? isDarkMode
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'bg-white text-slate-900 shadow-xs'
                        : isDarkMode
                        ? 'text-slate-400'
                        : 'text-slate-600'
                    }`}
                  >
                    With Stop
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateCurrentRoutine((prev) => ({ ...prev, includePitstopInRoute: false }))
                    }
                    className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                      !routine.includePitstopInRoute
                        ? isDarkMode
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'bg-white text-slate-900 shadow-xs'
                        : isDarkMode
                        ? 'text-slate-400'
                        : 'text-slate-600'
                    }`}
                  >
                    Direct
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Summary & Real-Time Traffic Banner (hidden in PiP map-only mode) */}
          {!isPipMode && (
            <div
              className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
                isDarkMode
                  ? 'border-slate-800 bg-slate-900/70'
                  : 'border-slate-200 bg-slate-50/70'
              }`}
            >
              <div className="min-w-0">
                <div
                  className={`text-sm font-bold truncate ${
                    isDarkMode ? 'text-slate-100' : 'text-slate-900'
                  }`}
                >
                  {routine.includePitstopInRoute && routine.preferredPitstop
                    ? `${routine.preferredPitstop.displayName} → ${
                        routine.destination?.displayName || currentConfig.destinationRoleLabel
                      }`
                    : `Direct to ${
                        routine.destination?.displayName || currentConfig.destinationRoleLabel
                      }`}
                </div>
                <div
                  className={`text-xs mt-0.5 ${
                    isDarkMode ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  {isComputingRoutes
                    ? 'Calculating shortest route...'
                    : routeError
                    ? routeError
                    : selectedRoute
                    ? selectedRoute.trafficCondition === 'HEAVY'
                      ? `Heavy traffic alert (+${selectedRoute.trafficDelayMinutes} min delay) · Shortest route`
                      : selectedRoute.trafficCondition === 'MODERATE'
                      ? `Moderate traffic (+${selectedRoute.trafficDelayMinutes} min) · Shortest route`
                      : 'Clear traffic · Shortest route selected'
                    : 'Waiting for route...'}
                </div>
              </div>

              {selectedRoute && (
                <div className="text-right shrink-0 font-mono tabular-nums">
                  <div
                    className={`text-base font-bold ${
                      isDarkMode ? 'text-blue-400' : 'text-blue-600'
                    }`}
                  >
                    {formatDuration(selectedRoute.durationMillis)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatDistance(selectedRoute.distanceMeters)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Single Map Viewport (Morphs into Floating Map-Only PiP Window when Minimized) */}
          <div
            className={
              isPipMode
                ? `fixed ${pipPositionClasses} z-50 w-[295px] sm:w-[340px] h-[205px] sm:h-[230px] rounded-2xl overflow-hidden border-2 shadow-2xl transition-all duration-200 ${
                    isDarkMode
                      ? 'border-slate-700 bg-slate-950 shadow-black/80'
                      : 'border-slate-300 bg-white shadow-slate-900/25'
                  }`
                : `w-full h-[360px] sm:h-[420px] rounded-2xl overflow-hidden border relative ${
                    isDarkMode ? 'border-slate-800' : 'border-slate-200'
                  }`
            }
          >
            {/* Minimal Overlay Controls shown ONLY inside Floating PiP Map Window */}
            {isPipMode && (
              <>
                {/* Top-Left Compact ETA & Traffic Pill */}
                <div className="absolute top-2.5 left-2.5 z-30 pointer-events-none flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/85 text-white text-[11px] font-mono tabular-nums border border-slate-800 shadow-md">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      selectedRoute?.trafficCondition === 'HEAVY'
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                    }`}
                  />
                  <span>
                    {selectedRoute
                      ? `${formatDuration(selectedRoute.durationMillis)} · ${formatDistance(
                          selectedRoute.distanceMeters
                        )}`
                      : 'Live Route'}
                  </span>
                </div>

                {/* Top-Right PiP Window Controls (Move Corner, OS PiP, Expand) */}
                <div className="absolute top-2.5 right-2.5 z-30 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleCyclePipCorner}
                    className="h-7 w-7 rounded-lg bg-slate-950/85 hover:bg-slate-900 text-slate-200 border border-slate-800 flex items-center justify-center shadow-md"
                    title="Move PiP window to next screen corner"
                    aria-label="Move PiP window to next screen corner"
                  >
                    <CornerDownRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleLaunchOsVideoPip}
                    className="h-7 w-7 rounded-lg bg-slate-950/85 hover:bg-slate-900 text-blue-400 border border-slate-800 flex items-center justify-center shadow-md"
                    title="Pop out native OS Picture-in-Picture window"
                    aria-label="Pop out native OS Picture-in-Picture window"
                  >
                    <PictureInPicture2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPipMode(false);
                      setScreenMode('route');
                    }}
                    className="h-7 px-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold flex items-center gap-1 shadow-md"
                    title="Expand back to full route screen"
                  >
                    <Maximize2 className="w-3 h-3" />
                    <span>Expand</span>
                  </button>
                </div>
              </>
            )}

            <CommuteMapCanvas
              userLocation={userLocation}
              simulatedPosition={null}
              activeRoutine={routine}
              travelMode="DRIVING"
              optimizationMode="SHORTEST_DISTANCE"
              showTrafficLayer={true}
              selectedRouteIndex={selectedRouteIndex}
              onSelectRouteIndex={setSelectedRouteIndex}
              onRoutesComputed={handleRoutesComputed}
              nearbySuggestions={nearbySuggestions}
              onNearbySuggestionsLoaded={handleNearbySuggestionsLoaded}
              onAutoSeedRoutinePlaces={handleAutoSeedRoutinePlaces}
              onSwapPitstop={handleSetPitstop}
              onSetDestination={handleSetDestination}
              searchCategoryFilter={currentConfig.defaultSearchCategory}
              isDarkMode={isDarkMode}
              isCompactPip={isPipMode}
              isMapVisible={screenMode === 'route' || isPipMode}
            />
          </div>

          {/* Simple Directions List (hidden in PiP map-only mode) */}
          {!isPipMode && selectedRoute && (
            <div
              className={`border rounded-2xl p-4 ${
                isDarkMode
                  ? 'border-slate-800 bg-slate-900/60'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="text-xs font-semibold text-slate-500 mb-2.5">
                Shortest Route Directions
              </div>
              <div
                className={`space-y-3 max-h-56 overflow-y-auto divide-y ${
                  isDarkMode ? 'divide-slate-800' : 'divide-slate-100'
                }`}
              >
                {selectedRoute.legs.map((leg) => (
                  <div key={leg.legIndex} className="pt-2 first:pt-0">
                    <div
                      className={`text-xs font-bold mb-1.5 ${
                        isDarkMode ? 'text-slate-200' : 'text-slate-900'
                      }`}
                    >
                      {leg.label} ({formatDistance(leg.distanceMeters)} ·{' '}
                      {formatDuration(leg.durationMillis)})
                    </div>
                    <ol className="space-y-1.5">
                      {leg.steps.slice(0, 8).map((step, idx) => (
                        <li
                          key={idx}
                          className={`text-xs flex items-start justify-between gap-3 ${
                            isDarkMode ? 'text-slate-300' : 'text-slate-600'
                          }`}
                        >
                          <span>
                            {idx + 1}. {step.instruction}
                          </span>
                          <span className="font-mono tabular-nums text-slate-500 shrink-0">
                            {formatDistance(step.distanceMeters)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-slate-500 text-right">
                OpenStreetMap · OSRM
              </div>
            </div>
          )}
        </div>

        {/* Simple Modal to Change Usual Pitstop or Destination for Current Time Slot */}
        {showSetupModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div
              className={`border rounded-3xl max-w-md w-full p-5 space-y-4 shadow-xl ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-800 text-slate-100'
                  : 'bg-white border-slate-200 text-slate-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold font-display">
                  Set Places ({currentConfig.headingTitle})
                </h2>
                <button
                  type="button"
                  onClick={() => setShowSetupModal(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <PlaceSearchInput
                label={`Usual ${currentConfig.pitstopRoleLabel}`}
                placeholder="Search place..."
                currentPlace={routine.preferredPitstop}
                originLocation={userLocation}
                onSelectPlace={handleSetPitstop}
                isDarkMode={isDarkMode}
              />

              <PlaceSearchInput
                label={`Primary Destination (${currentConfig.destinationRoleLabel})`}
                placeholder="Search destination address..."
                currentPlace={routine.destination}
                originLocation={userLocation}
                onSelectPlace={handleSetDestination}
                isDarkMode={isDarkMode}
              />

              <button
                type="button"
                onClick={() => setShowSetupModal(false)}
                className={`w-full min-h-[44px] text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors ${
                  isDarkMode
                    ? 'bg-blue-600 text-white hover:bg-blue-500'
                    : 'bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                <Check className="w-4 h-4" />
                <span>Done</span>
              </button>
            </div>
          </div>
        )}

        {/* Phone Install Guide Modal (Android & iOS) */}
        {showIOSInstallModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div
              className={`border rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-xl ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-800 text-slate-100'
                  : 'bg-white border-slate-200 text-slate-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold font-display">Install on Your Phone</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSInstallModal(false)}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs leading-relaxed">
                <div
                  className={`p-3 rounded-2xl border ${
                    isDarkMode
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  <div className="font-bold mb-1">Step 1: Enable Public Link First</div>
                  Preview links are private by default (which causes a "Page not found" error on other devices). Click the <strong>Share</strong> (or <strong>Deploy</strong>) button in the top-right toolbar of AI Studio and enable <strong>Public access</strong> to copy your phone-ready link.
                </div>

                <div
                  className={`p-3 rounded-2xl border ${
                    isDarkMode
                      ? 'border-slate-800 bg-slate-950/70 text-slate-300'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="font-bold text-blue-400 mb-1">Step 2: Android (Chrome)</div>
                  1. Open that shared link in <strong>Chrome</strong> on your Android phone.
                  <br />
                  2. Tap the blue <strong>Install</strong> button or Chrome's <strong>⋮ menu</strong> → <strong>Install app / Add to Home screen</strong>.
                </div>

                <div
                  className={`p-3 rounded-2xl border ${
                    isDarkMode
                      ? 'border-slate-800 bg-slate-950/70 text-slate-300'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="font-bold text-blue-400 mb-1">Step 2: iPhone (Safari)</div>
                  1. Open that shared link in <strong>Safari</strong>.
                  <br />
                  2. Tap the <strong>Share</strong> icon at the bottom and tap{' '}
                  <strong>Add to Home Screen</strong>.
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowIOSInstallModal(false)}
                className="w-full min-h-[42px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}

        {/* Quiet Footer */}
        <footer className="w-full max-w-md mx-auto px-6 py-3 text-center text-[11px] text-slate-500">
          Powered by OpenStreetMap & OSRM · 100% Free & Unlimited
        </footer>
      </div>
    );
}
