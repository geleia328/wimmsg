import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
export const metadata:Metadata={title:"Bakers Whisper — WoW Whisper Chat",description:"Whispers do World of Warcraft em múltiplas janelas, em um único painel."};
export const viewport:Viewport={width:"device-width",initialScale:1,themeColor:"#020617"};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="pt-BR"><body className="bg-slate-950 text-slate-100 antialiased">{children}</body></html>}
