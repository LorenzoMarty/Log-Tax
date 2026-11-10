import { z } from "zod";
import { handleChat, ReadOnlyError } from "@/chat/handle-chat";
import { getLlm } from "@/chat/llm-factory";
import { checkRate, clientIp, tooMany } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const body = z.object({
  workspaceId: z.uuid(),
  agentId: z.uuid().optional(),
  message: z.string().trim().min(1).max(4000),
  approve: z.array(z.string().max(2000)).max(10).optional(),
});

export async function POST(request: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return Response.json({ error: "Faça login para continuar." }, { status: 401 });

  const wait = await checkRate(sb, user.id, "chat", clientIp(request.headers));
  if (wait) return tooMany(wait);

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Mensagem inválida." }, { status: 400 });

  let llm;
  try {
    llm = getLlm();
  } catch {
    return Response.json({ error: "IA indisponível: configure OPENAI_API_KEY." }, { status: 503 });
  }

  try {
    const reply = await handleChat(sb, llm, parsed.data);
    if (!reply) return Response.json({ error: "Espaço não encontrado." }, { status: 404 });
    return Response.json(reply);
  } catch (e) {
    if (e instanceof ReadOnlyError) return Response.json({ error: e.message }, { status: 403 });
    console.error("chat failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Não consegui falar com a IA agora. Tente de novo." }, { status: 502 });
  }
}
