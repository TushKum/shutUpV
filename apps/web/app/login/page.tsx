import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { safeNext } from "@/lib/auth/routes";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Market Simulation" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  const viewer = await getViewer();
  if (viewer) redirect(safeNext(nextPath, viewer.role));

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Market Simulation</h1>
        <p className="mb-6 mt-1 text-sm text-slate-600">Sign in with the team code and password on your card.</p>
        <LoginForm next={nextPath} />
      </div>
    </main>
  );
}
