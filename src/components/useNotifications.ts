"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
    gain.gain.setValueAtTime(0, now + n.start);
    gain.gain.linearRampToValueAtTime(0.6, now + n.start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + n.start);
    osc.stop(now + n.start + n.dur + 0.02);
  }
}

export function useNotifications() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const unreadRef = useRef(0);
  const baseTitleRef = useRef<string | null>(null);

  useEffect(() => {
    setPrefs(loadPrefs());
    setReady(true);
    if (typeof document !== "undefined") {
      baseTitleRef.current = document.title;
    }
  }, []);

  useEffect(() => {
    if (ready) savePrefs(prefs);
  }, [prefs, ready]);

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
      audioCtxRef.current?.resume().catch(() => {});
    };
    window.addEventListener("click", prime, { once: false });
    window.addEventListener("keydown", prime, { once: false });
    return () => {
      window.removeEventListener("click", prime);
      window.removeEventListener("keydown", prime);
    };
  }, [ready]);

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
      if (prefs.sound && audioCtxRef.current) {
        try {
          playChime(audioCtxRef.current, prefs.volume);
        } catch {
          /* ignore */
        }
      }
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
            silent: prefs.sound, 
          });
        } catch {
          /* ignore */
        }
      }
      if (document.visibilityState !== "visible") {
        unreadRef.current += 1;
        if (baseTitleRef.current) {
          document.title = `(${unreadRef.current}) ${baseTitleRef.current}`;
        }
      }
    },
    [prefs],
  );

  return useMemo(
    () => ({
      ready,
      prefs,
      setSound,
      setVolume,
      setDesktop,
      testChime,
      notifyIncoming,
    }),
    [ready, prefs, setSound, setVolume, setDesktop, testChime, notifyIncoming],
  );
}
