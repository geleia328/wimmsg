"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Prefs = {
  sound: boolean;
  desktop: boolean;
  volume: number; // 0..1
};

const STORAGE_KEY = "bakers-whisper:notif-prefs";
const DEFAULTS: Prefs = { sound: true, desktop: false, volume: 0.5 };

function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function savePrefs(p: Prefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/**
 * Small two-note "ping-pong" chime synthesized in-browser via WebAudio.
 * No external asset required — works offline and stays crisp on any device.
 */
function playChime(ctx: AudioContext, volume: number) {
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);

  const notes = [
    { freq: 880, start: 0.0, dur: 0.12 }, // A5
    { freq: 1318.5, start: 0.09, dur: 0.16 }, // E6
  ];

  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = n.freq;
    // Quick attack, gentle release for a "ding"
    gain.gain.setValueAtTime(0, now + n.start);
    gain.gain.linearRampToValueAtTime(0.6, now + n.start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + n.start);
    osc.stop(now + n.start + n.dur + 0.02);
  }
}

/**
 * `useNotifications` centralises: audio chime, browser notifications, tab
 * title unread counter, and user preferences (persisted to localStorage).
 *
 * Usage:
 *   const notif = useNotifications();
 *   notif.notifyIncoming({ character, player, body });
 */
export function useNotifications() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const unreadRef = useRef(0);
  const baseTitleRef = useRef<string | null>(null);

  // Load prefs client-side to avoid SSR mismatches.
  useEffect(() => {
    setPrefs(loadPrefs());
    setReady(true);
    if (typeof document !== "undefined") {
      baseTitleRef.current = document.title;
    }
  }, []);

  // Persist on change.
  useEffect(() => {
    if (ready) savePrefs(prefs);
  }, [prefs, ready]);

  // Browsers require a user gesture before starting AudioContext.
  // We install a one-time listener that primes the context on any click/key.
  useEffect(() => {
    if (!ready) return;
    const prime = () => {
      if (!audioCtxRef.current) {
        try {
          const AC =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          audioCtxRef.current = new AC();
        } catch {
          /* audio unsupported */
        }
      }
      // Resume in case it was suspended.
      audioCtxRef.current?.resume().catch(() => {});
    };
    window.addEventListener("click", prime, { once: false });
    window.addEventListener("keydown", prime, { once: false });
    return () => {
      window.removeEventListener("click", prime);
      window.removeEventListener("keydown", prime);
    };
  }, [ready]);

  // Clear unread badge when the tab becomes visible.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        unreadRef.current = 0;
        if (baseTitleRef.current) document.title = baseTitleRef.current;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const setSound = useCallback(
    (v: boolean) => setPrefs((p) => ({ ...p, sound: v })),
    [],
  );
  const setVolume = useCallback(
    (v: number) => setPrefs((p) => ({ ...p, volume: Math.max(0, Math.min(1, v)) })),
    [],
  );
  const setDesktop = useCallback(async (v: boolean) => {
    if (v && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      try {
        const res = await Notification.requestPermission();
        if (res !== "granted") {
          setPrefs((p) => ({ ...p, desktop: false }));
          return;
        }
      } catch {
        return;
      }
    }
    setPrefs((p) => ({ ...p, desktop: v }));
  }, []);

  const testChime = useCallback(() => {
    if (!audioCtxRef.current) return;
    try {
      playChime(audioCtxRef.current, prefs.volume);
    } catch {
      /* ignore */
    }
  }, [prefs.volume]);

  const notifyIncoming = useCallback(
    (msg: { character: string; player: string; body: string }) => {
      // Sound
      if (prefs.sound && audioCtxRef.current) {
        try {
          playChime(audioCtxRef.current, prefs.volume);
        } catch {
          /* ignore */
        }
      }
      // Desktop notification (only if tab hidden — avoid double stimulation)
      if (
        prefs.desktop &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        document.visibilityState !== "visible"
      ) {
        try {
          new Notification(`Whisper de ${msg.player}`, {
            body: `[${msg.character}] ${msg.body}`,
            tag: `wim-${msg.character}-${msg.player}`,
            silent: prefs.sound, // avoid double beep
          });
        } catch {
          /* ignore */
        }
      }
      // Tab title unread badge
      if (document.visibilityState !== "visible") {
        unreadRef.current += 1;
        if (baseTitleRef.current) {
          document.title = `(${unreadRef.current}) ${baseTitleRef.current}`;
        }
      }
    },
    [prefs],
  );

  return {
    prefs,
    setSound,
    setVolume,
    setDesktop,
    testChime,
    notifyIncoming,
    ready,
  };
}
