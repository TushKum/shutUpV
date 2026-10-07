import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { homeFor } from "@/lib/auth/routes";

export default async function Home() {
  const viewer = await getViewer();
  redirect(viewer ? homeFor(viewer.role) : "/login");
}
