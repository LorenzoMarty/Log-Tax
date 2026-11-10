/** Public origin of the site, for canonical links and previews. Set NEXT_PUBLIC_SITE_URL (Vercel: the production domain). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/$/, "");
export const SITE_NAME = "Log Tax";
export const SITE_DESCRIPTION = "Converse com uma IA que organiza, calcula e acompanha os seus impostos: empresa ou pessoa física, em linguagem simples.";
