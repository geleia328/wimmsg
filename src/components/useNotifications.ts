"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Generates short notification chimes with the Web Audio API so the app needs
 * no external sound assets. Four signals are supported:
 *   inbound-new     → a fresh whisper arrived
 *   inbound-active  → the conversation is already open
 *   outbound-sent   → reply confirmed by the bridge
 *   outbound-failed → reply timed out / failed
 */
export type SoundKey =
  | "inbound-new"
  | "inbound-active"
  | "outbound-sent"
  | "outbound-failed";

const PRESETS: Record<SoundKey, { freqs: number[]; type: OscillatorType; dur: number }> = {
  "inbound-new": { freqs: [880, 1175, 1568], type: "sine", dur: 0.16 },
  "inbound-active": { freqs: [988], type: "sine", dur: 0.08 },
  "outbound-sent": { freqs: [660, 880], type: "triangle", dur: 0.1 },
  "outbound-failed": { freqs: [330, 220], type: "sawtooth", dur: 0.22 },
};

export function useNotifications() {
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolume] = useState(0.5);
  const ctxRef = useRef<AudioContext | null>(null);

  // Lazily create the AudioContext after a user gesture (browser autoplay rules).
  const ensureCtx = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) ctxRef.current = new Ctor();
    }
    if (ctxRef.current?.state === "suspended") {
      void ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const play = useCallback(
    (key: SoundKey) => {
      if (!enabled) return;
      const ctx = ensureCtx();
      if (!ctx) return;
      const preset = PRESETS[key];
      const now = ctx.currentTime;
      preset.freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = preset.type;
        osc.frequency.value = freq;
        const start = now + i * (preset.dur * 0.6);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + preset.dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + preset.dur + 0.02);
      });
    },
    [enabled, volume, ensureCtx],
  );

  // Restore last preferences.
  useEffect(() => {
    const e = window.localStorage.getItem("bw_sound_enabled");
    const v = window.localStorage.getItem("bw_sound_volume");
    if (e !== null) setEnabled(e === "1");
    if (v !== null) setVolume(Math.max(0, Math.min(1, Number(v) || 0.5)));
  }, []);

  useEffect(() => {
    window.localStorage.setItem("bw_sound_enabled", enabled ? "1" : "0");
  }, [enabled]);
  useEffect(() => {
    window.localStorage.setItem("bw_sound_volume", String(volume));
  }, [volume]);

  const unlock = useCallback(() => {
    ensureCtx();
    play("outbound-sent");
  }, [ensureCtx, play]);

  return { enabled, setEnabled, volume, setVolume, play, unlock };
}
