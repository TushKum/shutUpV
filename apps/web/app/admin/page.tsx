import { getViewer } from "@/lib/auth/viewer";
import { SignOutButton } from "@/components/sign-out-button";

// Placeholder until Phase 3 (control panel).
export default async function AdminHome() {
  const viewer = (await getViewer())!;
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Control panel</h1>
        <SignOutButton />
      </div>
      <p className="mt-1 text-slate-600">
        {viewer.displayName} · {viewer.role === "FAIRNESS" ? "Fairness officer" : "Organiser"}
      </p>
      <p className="mt-6 rounded-md bg-slate-100 p-4 text-sm text-slate-700">You are signed in. The control panel is built in Phase 3.</p>
    </main>
  );
}
