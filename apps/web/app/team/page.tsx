import type { Metadata } from "next";
import { loadTeamContext } from "@/lib/team/context";
import { Notice } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Home" };

// Home (built out by the common workstream): what this team should do now.
export default async function TeamHome() {
  const { team } = await loadTeamContext();
  return <Notice>Welcome, {team.name}.</Notice>;
}
