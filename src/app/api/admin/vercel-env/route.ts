import { checkAdminAuth } from "@/lib/auth";

export async function POST(request: Request) {
  const denied = checkAdminAuth(request); if (denied) return denied;
  const data = await request.json().catch(() => ({})) as { vercelToken?:string; projectIdOrName?:string; teamId?:string; databaseUrl?:string; bridgeToken?:string; deployHookUrl?:string };
  if (!data.vercelToken || !data.projectIdOrName) return Response.json({ error:"Token Vercel e projeto são obrigatórios" }, { status:400 });
  if (data.databaseUrl && (!data.databaseUrl.startsWith("postgresql://") || !data.databaseUrl.includes("@") || !data.databaseUrl.includes("/") || !data.databaseUrl.includes("sslmode=require"))) return Response.json({ error:"DATABASE_URL inválida: use PostgreSQL pooled com sslmode=require" }, { status:400 });
  const entries = [["DATABASE_URL",data.databaseUrl],["BRIDGE_TOKEN",data.bridgeToken]].filter((item): item is [string,string] => Boolean(item[1]));
  const query = data.teamId ? `?upsert=true&teamId=${encodeURIComponent(data.teamId)}` : "?upsert=true";
  const url = `https://api.vercel.com/v10/projects/${encodeURIComponent(data.projectIdOrName)}/env${query}`;
  const updated:string[] = [];
  for (const [key,value] of entries) {
    const response = await fetch(url,{ method:"POST", headers:{ authorization:`Bearer ${data.vercelToken}`, "content-type":"application/json" }, body:JSON.stringify([{ key,value,type:"sensitive",target:["production"],comment:"Atualizado pelo Bakers Whisper" }]) });
    if (!response.ok) return Response.json({ error:`Vercel recusou ${key}`, details:await response.text() },{ status:response.status }); updated.push(key);
  }
  let redeployed=false; if (data.deployHookUrl) { const response=await fetch(data.deployHookUrl,{method:"POST"}); redeployed=response.ok; }
  return Response.json({ ok:true, updated, redeployed, message:redeployed?"Variáveis atualizadas e deploy acionado.":"Variáveis atualizadas. Faça um novo deploy manual." });
}
