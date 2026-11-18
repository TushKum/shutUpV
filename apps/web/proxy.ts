// Refresh Supabase sessions for the real application while keeping local preview routes
// completely independent from backend configuration.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { areaOf } from "@/lib/auth/routes";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Make the local frontend preview the default landing page.
  if (path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/preview";
    return NextResponse.redirect(url);
  }

  // Preview pages are static/mock-data screens and must never initialise Supabase.
  if (path === "/preview" || path.startsWith("/preview/") || path === "/newsroom-preview") {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list, headers) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && areaOf(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)"],
};
