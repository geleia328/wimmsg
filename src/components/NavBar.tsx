"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "💬 Chat" },
  { href: "/accounts", label: "🖥 Contas" },
  { href: "/gse", label: "⚙ GSE" },
  { href: "/settings", label: "🔧 Config" },
  { href: "/download", label: "⬇ Bridge" },
  { href: "/setup", label: "📘 Setup" },
];

export default function NavBar() {
  const path = usePathname();
  return (
    <nav className="sticky top-0 z-40 flex h-14 items-center gap-1 border-b border-slate-800 bg-slate-900/95 px-3 backdrop-blur">
      <Link href="/" className="mr-2 flex items-center gap-2 font-semibold">
        <span className="text-xl">🥐</span>
        <span className="hidden sm:inline">Bakers Whisper</span>
      </Link>
      <div className="scroll-x flex flex-1 items-center gap-1">
        {links.map((l) => {
          const active = path === l.href || (l.href !== "/" && path?.startsWith(l.href));
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
                active ? "bg-emerald-600 text-white" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
