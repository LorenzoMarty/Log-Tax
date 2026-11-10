import { z } from "zod";
import { handleChat, ReadOnlyError } from "@/chat/handle-chat";
import { getLlm } from "@/chat/llm-factory";
import { errorFields, log, requestIdOf } from "@/lib/log";
import { checkRate, clientIp, tooMany } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const body = z.object({
  workspaceId: z.uuid(),
  agentId: z.uuid().optional(),
  message: z.string().trim().min(1).max(4000),
  approve: z.array(z.string().max(2000)).max(10).optional(),
});

export async function POST(request: Request) {
  const started = Date.now();
  const requestId = requestIdOf(request.headers);
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
    const { usage, ...body } = reply;
    // Metrics only: who (opaque id), where, which tools, how long, how many tokens. Never the message or the answer.
    log("info", "chat", {
      requestId,
      userId: user.id,
      workspaceId: parsed.data.workspaceId,
      agentId: parsed.data.agentId,
      tools: body.events.map((e) => `${e.name}:${e.status}`),
      latencyMs: Date.now() - started,
      tokensIn: usage.input,
      tokensOut: usage.output,
    });
    return Response.json(body);
  } catch (e) {
    if (e instanceof ReadOnlyError) return Response.json({ error: e.message }, { status: 403 });
    log("error", "chat_failed", { requestId, userId: user.id, workspaceId: parsed.data.workspaceId, latencyMs: Date.now() - started, error: errorFields(e) });
    return Response.json({ error: "Não consegui falar com a IA agora. Tente de novo." }, { status: 502 });
  }
}
