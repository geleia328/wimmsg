import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bakers Whisper — painel de whispers do WoW",
  description:
    "Agregue e responda whispers do World of Warcraft de várias janelas ao mesmo tempo, direto do navegador.",
};

const NAV = [
  { href: "/", label: "Conversas", icon: "💬" },
  { href: "/gse", label: "GSE", icon: "⌨️" },
  { href: "/contas", label: "Contas", icon: "🪟" },
  { href: "/configuracoes", label: "Configurações", icon: "⚙️" },
  { href: "/setup", label: "Setup / Bridge", icon: "🐍" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen text-slate-100 antialiased">
        <div className="flex min-h-screen flex-col">
          <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/70 backdrop-blur">
            <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3">
              <Link href="/" className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/20 text-lg">
                  🥐
                </span>
                <span className="text-base font-semibold tracking-tight">
                  Bakers Whisper
                </span>
              </Link>
              <nav className="ml-auto flex flex-wrap items-center gap-1 text-sm">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-lg px-3 py-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                  >
                    <span className="mr-1.5">{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
            {children}
          </main>
          <footer className="border-t border-white/10 px-4 py-4 text-center text-xs text-slate-500">
            Ferramenta pessoal de conveniência. Automatizar input em jogos online
            viola o ToS da Blizzard — use com bom senso.
          </footer>
        </div>
      </body>
    </html>
  );
}
