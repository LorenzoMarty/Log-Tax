import { buildExport } from "@/account/export";
import { audit } from "@/lib/audit";
import { checkRate, clientIp, tooMany } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/** LGPD art. 18: the signed-in person downloads their own data as one JSON file. */
export async function GET(request: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return Response.json({ error: "Faça login para continuar." }, { status: 401 });
  const wait = await checkRate(sb, user.id, "export", clientIp(request.headers));
  if (wait) return tooMany(wait);

  const data = await buildExport(sb, user);
  await audit(sb, null, "data_exported");
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="log-tax-meus-dados.json"',
      "Cache-Control": "no-store",
    },
  });
}
