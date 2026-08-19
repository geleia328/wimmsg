"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type HeaderConfig = {
  icon: string;
  title: string;
  subtitle: string;
  iconGradient: string;
};

const HEADER_CONFIGS: Record<string, HeaderConfig> = {
  "/": {
    icon: "💬",
    title: "Bakers Whisper",
    subtitle: "",
    iconGradient: "from-yellow-500 to-amber-700",
  },
  "/accounts": {
    icon: "📡",
    title: "Varredura de contas WoW",
    subtitle: "Detecta em tempo real quais janelas do WoW estão abertas no seu PC",
    iconGradient: "from-emerald-500 to-teal-700",
  },
  "/gse": {
    icon: "⚙",
    title: "Controle GSE",
    subtitle: "Ativa/desativa o macro GSE em cada janela",
    iconGradient: "from-fuchsia-500 to-purple-700",
  },
  "/settings": {
    icon: "🔐",
    title: "Configurações",
    subtitle: "Painel administrativo",
    iconGradient: "from-sky-500 to-blue-700",
  },
  "/download": {
    icon: "📥",
    title: "Download",
    subtitle: "BakersWhisper.exe e arquivos",
    iconGradient: "from-amber-500 to-orange-700",
  },
  "/setup": {
    icon: "🛠️",
    title: "Setup",
    subtitle: "Tutorial de configuração",
    iconGradient: "from-slate-500 to-slate-700",
  },
};

const NAV_PILLS = [
  { href: "/download", label: "📥 Download", color: "amber" },
  { href: "/accounts", label: "📡 Contas", color: "emerald" },
  { href: "/gse", label: "⚙ GSE", color: "fuchsia" },
  { href: "/settings", label: "🔐 Config", color: "sky" },
  { href: "/diagnostics", label: "🧪 Diagnóstico", color: "cyan" },
  { href: "/setup", label: "Setup", color: "slate" },
];

interface LayoutProps {
  children: ReactNode;
  stats?: React.ReactNode;
}

export function Layout({ children, stats }: LayoutProps) {
  const pathname = usePathname();
  const [online, setOnline] = useState(0);
  const [chars, setChars] = useState(0);
  const [convs, setConvs] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  const config = HEADER_CONFIGS[pathname] || HEADER_CONFIGS["/"];

  // Poll stats on home page
  useEffect(() => {
    if (pathname !== "/") return;
    const tick = async () => {
      try {
        const [wRes, cRes, convRes] = await Promise.all([
          fetch("/api/status", { cache: "no-store" }),
          fetch("/api/characters", { cache: "no-store" }),
          fetch("/api/conversations", { cache: "no-store" }),
        ]);
        setIsConnected(wRes.ok && cRes.ok && convRes.ok);
        if (wRes.ok) {
          const d = (await wRes.json()) as { windows: unknown[] };
          const fresh = d.windows.filter(
            (w: any) =>
              new Date().getTime() - new Date(w.lastSeen).getTime() < 15000,
          );
          setOnline(fresh.length);
        }
        if (cRes.ok) {
          const d = (await cRes.json()) as { characters: unknown[] };
          setChars(d.characters.length);
        }
        if (convRes.ok) {
          const d = (await convRes.json()) as { conversations: unknown[] };
          setConvs(d.conversations.length);
        }
      } catch {
        setIsConnected(false);
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, [pathname]);

  const isActive = (href: string) =>
    pathname === href ||
    (pathname === "/" && href === "/") ||
    (pathname.startsWith(href) && href !== "/");

  return (
    <div className="flex min-h-dvh w-full flex-col">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/80 px-3 py-2.5 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${config.iconGradient} font-black text-slate-900 shadow sm:h-9 sm:w-9`}
          >
            {config.icon}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold leading-tight sm:text-lg">
              {config.title}
            </h1>
            <p className="truncate text-[11px] text-slate-400 sm:text-xs">
              {pathname === "/" ? (
                <>
                  <span className="mr-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px] shadow-emerald-500/60 align-middle" />
                    {""} {online} janela(s) online
                  </span>
                  · {chars} personagens · {convs} conversas
                </>
              ) : (
                config.subtitle
              )}
            </p>
          </div>
        </div>

        <nav className="order-last -mx-1 flex w-full items-center gap-1.5 overflow-x-auto px-1 pb-0.5 text-xs md:order-none md:mx-0 md:w-auto md:overflow-visible md:px-0 md:pb-0">
          {NAV_PILLS.map((pill) => {
            const colors: Record<string, { border: string; bg: string; text: string; hover: string }> = {
              amber: { border: "border-amber-500/50", bg: "bg-amber-500/10", text: "text-amber-300", hover: "hover:bg-amber-500/20" },
              emerald: { border: "border-emerald-500/50", bg: "bg-emerald-500/10", text: "text-emerald-300", hover: "hover:bg-emerald-500/20" },
              fuchsia: { border: "border-fuchsia-500/50", bg: "bg-fuchsia-500/10", text: "text-fuchsia-300", hover: "hover:bg-fuchsia-500/20" },
              sky: { border: "border-sky-500/50", bg: "bg-sky-500/10", text: "text-sky-300", hover: "hover:bg-sky-500/20" },
              cyan: { border: "border-cyan-500/50", bg: "bg-cyan-500/10", text: "text-cyan-300", hover: "hover:bg-cyan-500/20" },
              slate: { border: "border-slate-700", bg: "bg-transparent", text: "text-slate-300", hover: "hover:bg-slate-800" },
            };
            const c = colors[pill.color];
            return (
              <Link
                key={pill.href}
                href={pill.href}
                className={`whitespace-nowrap rounded border px-2.5 py-1 transition md:px-3 ${
                  isActive(pill.href)
                    ? `${c.border} ${c.bg} ${c.text} ${c.hover}`
                    : "border-slate-700 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {pill.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${
              isConnected ? "bg-emerald-500" : "bg-rose-500"
            }`}
          />
          <span className="hidden text-slate-400 sm:inline">
            {isConnected ? "conectado" : "sem conexão"}
          </span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">{children}</div>

      {stats}
    </div>
  );
}
