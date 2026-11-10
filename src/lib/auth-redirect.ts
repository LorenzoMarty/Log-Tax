const PROTECTED_PREFIXES = ["/workspace"];

/**
 * Where the middleware sends a request, or null to let it through. Signed-in people skip the home page
 * (it only explains the product and links to sign-in, #14); visitors are sent to sign in before private pages.
 * Example: `authRedirectPath("/", true) === "/workspace"`.
 */
export function authRedirectPath(pathname: string, signedIn: boolean, needsSecondFactor = false): string | null {
  // Two-factor on: private pages wait for the code. (The code page and the public pages stay reachable.)
  if (signedIn && needsSecondFactor && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return "/login/verificar";
  if (signedIn) return pathname === "/" ? "/workspace" : null;
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ? "/login" : null;
}
