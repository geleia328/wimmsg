"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Notificações sonoras + Notification API para novos sussurros.
 *
 * - Beep: sempre toca quando `enabled` (mesmo que a aba esteja visível,
 *   o usuário pode estar em outra janela). Usa WebAudio — sem arquivo
 *   externo.
 * - Notification: pede permissão no primeiro clique no 🔔. Só dispara
 *   se a aba estiver OCULTA (se a aba está visível, o som + a bolinha
 *   na sidebar já são feedback suficiente; o Notification do browser
 *   não dispara quando a aba está em foco).
 */
export function useNotifications() {
  const ready = true;
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("bw:sound") !== "0";
  });
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === "undefined" ? "default" : Notification.permission,
  );
  const ctxRef = useRef<AudioContext | null>(null);
  const lastBeepAt = useRef(0);

  // Persiste a preferência.
  useEffect(() => {
    if (ready) window.localStorage.setItem("bw:sound", enabled ? "1" : "0");
  }, [enabled, ready]);

  const context = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    return ctxRef.current;
  }, []);

  const beep = useCallback(() => {
    // Evita encavalar beeps se vier mensagem muito rápida
    const now = Date.now();
    if (now - lastBeepAt.current < 300) return;
    lastBeepAt.current = now;

    const ctx = context();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    // Dois tons curtos em sequência (mais "notificação" do que "erro")
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
    osc.frequency.setValueAtTime(1320, t + 0.10);
    osc.frequency.exponentialRampToValueAtTime(1100, t + 0.20);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.36);
  }, [context]);

  const notify = useCallback(
    (title: string, body: string) => {
      if (!enabled) return;
      beep();
      // Notificação do SO só quando a aba está OCULTA (senão o browser
      // ignora, e o som + a bolinha na sidebar já dão feedback)
      const tabHidden = typeof document !== "undefined" && document.hidden;
      if (!tabHidden) return;
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const n = new Notification(title, {
            body,
            icon: "/icon.svg",
            badge: "/icon.svg",
            tag: "bw-whisper",
            requireInteraction: false,
            silent: true, // o beep já tocou
          });
          n.onclick = () => {
            try {
              window.focus();
              n.close();
            } catch {
              /* ignore */
            }
          };
        }
      } catch {
        /* notificações do SO são opcionais */
      }
    },
    [beep, enabled],
  );

  const requestPermission = useCallback(async () => {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        const p = await Notification.requestPermission();
        setPermission(p);
        return p;
      }
      return Notification.permission;
    } catch {
      return "denied" as NotificationPermission;
    }
  }, []);

  const toggleEnabled = useCallback(() => {
    setEnabled((v) => !v);
  }, []);

  return {
    ready,
    enabled,
    permission,
    setEnabled,
    toggleEnabled,
    notify,
    requestPermission,
    beep, // exposto para teste
  };
}
