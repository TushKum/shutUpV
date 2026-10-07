import { requireRole } from "@/lib/auth/viewer";

export default async function TeamLayout({ children }: LayoutProps<"/team">) {
  await requireRole(["TEAM"], "/team");
  return children;
}
