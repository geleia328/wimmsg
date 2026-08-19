import { readFile } from "node:fs/promises";
import path from "node:path";
export async function GET() { for(const file of ["RELATORIO_COMPLETO.md","RELATORIO.md"]) try { const text=await readFile(path.join(process.cwd(),"docs",file),"utf8"); return new Response(text,{headers:{"content-type":"text/markdown; charset=utf-8"}}); } catch {} return new Response("Relatório não encontrado",{status:404}); }
