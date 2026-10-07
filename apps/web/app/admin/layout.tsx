import { requireRole } from "@/lib/auth/viewer";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireRole(["ORGANISER", "FAIRNESS"], "/admin");
  return children;
}
