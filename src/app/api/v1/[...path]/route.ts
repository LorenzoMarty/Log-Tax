import { proxyToApi } from "@/lib/api-proxy";

// The browser talks to the FastAPI backend through this same-origin proxy (the session cookie never leaves this server).
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };
const handle = async (request: Request, { params }: Context) => proxyToApi(request, (await params).path);

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
