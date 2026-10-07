import { getViewer } from "@/lib/auth/viewer";
import { SignOutButton } from "@/components/sign-out-button";

const TRACK_LABEL = { PRODUCT: "Product", CONSULTING: "Consulting", FINANCE: "Finance" } as const;

// Placeholder until Phase 4 (team portal).
export default async function TeamHome() {
  const viewer = (await getViewer())!;
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{viewer.team?.code}</h1>
        <SignOutButton />
      </div>
      <p className="mt-1 text-slate-600">
        {viewer.team?.name} · {viewer.team ? TRACK_LABEL[viewer.team.track] : ""} track
      </p>
      <p className="mt-6 rounded-md bg-slate-100 p-4 text-sm text-slate-700">You are signed in. The team portal is built in Phase 4.</p>
    </main>
  );
}
