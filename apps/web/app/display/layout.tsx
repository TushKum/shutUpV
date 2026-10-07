import { requireRole } from "@/lib/auth/viewer";

export default async function DisplayLayout({ children }: LayoutProps<"/display">) {
  await requireRole(["DISPLAY", "ORGANISER", "FAIRNESS"], "/display");
  return children;
}
