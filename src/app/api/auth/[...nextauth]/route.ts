import { NextRequest } from "next/server";
import { handlers } from "@/auth";

export async function GET(request: NextRequest) {
  return withCleanEnv(handlers.GET, request);
}

export async function POST(request: NextRequest) {
  return withCleanEnv(handlers.POST, request);
}

/**
 * next-auth's `reqWithEnvURL` (lib/env.js) rewrites the request origin
 * to match `AUTH_URL`/`NEXTAUTH_URL`. In production those may be unset
 * or still point to `localhost:3000` from the `.env` template, which
 * corrupts the internal URL and causes `@auth/core` to redirect GET
 * session requests to an HTML error page instead of returning JSON.
 *
 * We temporarily clear the env var so `reqWithEnvURL` returns the
 * request URL unchanged.
 */
async function withCleanEnv(
  handler: (req: NextRequest) => Promise<Response>,
  request: NextRequest,
): Promise<Response> {
  const orig = process.env.AUTH_URL;
  const origNext = process.env.NEXTAUTH_URL;

  const needsCleanup =
    orig?.includes("localhost") || origNext?.includes("localhost");

  if (needsCleanup) {
    process.env.AUTH_URL = "";
    process.env.NEXTAUTH_URL = "";
  }

  try {
    return await handler(request);
  } finally {
    if (needsCleanup) {
      process.env.AUTH_URL = orig;
      process.env.NEXTAUTH_URL = origNext;
    }
  }
}
