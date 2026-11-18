import type { Metadata } from "next";
import { NewsroomView } from "../team/newsroom/newsroom-view";

export const metadata: Metadata = { title: "Newsroom Preview · PRIMUS" };

export default function NewsroomPreviewPage() {
  return (
    <main className="min-h-dvh bg-[#070909] px-4 py-8 text-white sm:px-6 lg:px-8">
      <NewsroomView />
    </main>
  );
}
