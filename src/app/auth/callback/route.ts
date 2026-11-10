import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await audit(supabase, null, "login");
      return NextResponse.redirect(`${origin}/workspace`);
    }
  }
  return NextResponse.redirect(`${origin}/login?erro=1`);
}
