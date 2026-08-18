"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem("bakers.tts.enabled");
      if (v === "1") setTtsEnabled(true);
    } catch {
      /* ignore */
    }
  }, []);

  const setTts = useCallback((on: boolean) => {
    setTtsEnabled(on);
    try {
      window.localStorage.setItem("bakers.tts.enabled", on ? "1" : "0");
    } catch { /* ignore */ }
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;
    if (!ttsEnabled) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 1.0;
      u.volume = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const pt = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("pt"));
      if (pt) u.voice = pt;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }, [ttsEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  const request = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
    } catch {
      /* ignore */
    }
  }, []);

  const beep = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      type WithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };
      const w = window as WithWebkit;
      const AC = window.AudioContext || w.webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.0001;
      o.connect(g).connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      o.start(now);
      o.stop(now + 0.3);
    } catch {
      /* ignore */
    }
  }, []);

  const notify = useCallback((title: string, body?: string) => {
    beep();
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
      new Notification(title, { body, tag: `bakers-${title}` });
    } catch {
      /* ignore */
    }
  }, [beep]);

  return { permission, request, notify, beep, ttsEnabled, setTts, speak };
}
