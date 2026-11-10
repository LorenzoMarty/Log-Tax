import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authRedirectPath } from "@/lib/auth-redirect";
import { publicEnv } from "@/lib/env";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = publicEnv();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
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
  if (!target) return response;
  const url = request.nextUrl.clone();
  url.pathname = target;
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
