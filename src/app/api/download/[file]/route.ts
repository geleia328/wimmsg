import { readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED = new Set(["WIMBridge.zip","wim_bridge.py","wim_bridge_gui.py","ocr_bridge.py","requirements.txt","config.example.ini","WIMBridge.lua","WIMBridge.toc"]);
const types:Record<string,string>={ ".zip":"application/zip", ".py":"text/x-python; charset=utf-8", ".txt":"text/plain; charset=utf-8", ".ini":"text/plain; charset=utf-8", ".lua":"text/plain; charset=utf-8", ".toc":"text/plain; charset=utf-8" };
export async function GET(_:Request,{params}:{params:Promise<{file:string}>}) {
  const {file}=await params; if(!ALLOWED.has(file)) return Response.json({error:"Arquivo não permitido"},{status:404});
  for(const folder of ["", "WIMBridge"]) try { const buffer=await readFile(path.join(process.cwd(),"public","downloads",folder,file)); return new Response(buffer,{headers:{"content-type":types[path.extname(file)]||"application/octet-stream","content-disposition":`attachment; filename="${file}"`}}); } catch {}
  return Response.json({error:"Arquivo não encontrado"},{status:404});
}
