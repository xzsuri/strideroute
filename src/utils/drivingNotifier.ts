export interface DrivingNotificationPayload {
  title: string;
  body: string;
  pitstopQuestion: string;
  directQuestion: string;
  voiceText?: string;
}

let lastSpokenText: string | null = null;
let lastSpokenAt = 0;
let lastNotificationAt = 0;

export async function ensureServiceWorkerRegistered(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    return await navigator.serviceWorker.register('/sw-commute.js');
  } catch {
    return null;
  }
}

export async function requestNotificationPermissionIfNeeded(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function stopDrivingSpeech() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
    }
  } catch {
    // ignore speech cancel errors
  }
}

export function speakDrivingPrompt(text: string, force: boolean = false) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  const now = Date.now();
  // Prevent repeating or looping the same TTS line
  if (!force) {
    if (lastSpokenText === text && now - lastSpokenAt < 300000) {
      return;
    }
    if (now - lastSpokenAt < 30000) {
      return;
    }
  }

  lastSpokenText = text;
  lastSpokenAt = now;

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    utterance.onend = () => {
      // Ensure queue stays clear after speaking once
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    };
    window.speechSynthesis.speak(utterance);
  } catch {
    // ignore speech errors
  }
}

export async function triggerDrivingNotification(
  payload: DrivingNotificationPayload,
  enableVoice: boolean = false,
  options: { isManualTest?: boolean } = {}
): Promise<boolean> {
  const now = Date.now();
  const isManual = Boolean(options.isManualTest);

  // Cooldown for automatic background notifications so tab switching never loops
  if (!isManual && now - lastNotificationAt < 60000) {
    return false;
  }
  lastNotificationAt = now;

  if (enableVoice && payload.voiceText) {
    speakDrivingPrompt(payload.voiceText, isManual);
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  // Only request permission interactively on manual test; in background, check existing permission
  const perm = isManual
    ? await requestNotificationPermissionIfNeeded()
    : Notification.permission;

  if (perm !== 'granted') {
    return false;
  }

  try {
    const reg = await ensureServiceWorkerRegistered();
    if (reg && reg.active) {
      reg.active.postMessage({
        type: 'SHOW_DRIVING_NOTIFICATION',
        payload,
      });
      return true;
    }
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(payload.title, {
        body: payload.body,
        icon: '/pwa-192x192.png',
        tag: 'strideroute-driving-prompt',
      });
      return true;
    }
    new Notification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      tag: 'strideroute-driving-prompt',
    });
    return true;
  } catch {
    return false;
  }
}
