import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authRedirectPath } from "@/lib/auth-redirect";
import { publicEnv } from "@/lib/env";

export async function middleware(request: NextRequest) {
  // Every request carries an id: handlers log it, and it is echoed in the response so a report can be traced.
  const requestId = crypto.randomUUID();
  const forwarded = new Headers(request.headers);
  forwarded.set("x-request-id", requestId);
  let response = NextResponse.next({ request: { headers: forwarded } });
  const env = publicEnv();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: forwarded } });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() validates the JWT with the Auth server (getSession() would trust the cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const aal = user ? (await supabase.auth.mfa.getAuthenticatorAssuranceLevel()).data : null;
  const needsSecondFactor = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2";
  const target = authRedirectPath(request.nextUrl.pathname, user !== null, needsSecondFactor);
  response.headers.set("x-request-id", requestId);
  if (!target) return response;
  const url = request.nextUrl.clone();
  url.pathname = target;
  url.search = "";
  const redirect = NextResponse.redirect(url);
  redirect.headers.set("x-request-id", requestId);
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/cron|api/vitals|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
