import { loadTeamContext } from "@/lib/team/context";
import { sectionAllowed } from "@/lib/team/sections";
import { SquadTabs } from "./tabs";

// The squad workspace (Product and Consulting): the overview, the problem card, and the pitch, plan and flash
// editors. A Finance team's pages show where its squad work is instead.
export default async function SquadLayout({ children }: LayoutProps<"/team/squad">) {
  const { team } = await loadTeamContext();
  if (!sectionAllowed(team.track, "/squad")) return <>{children}</>;
  return (
    <div className="space-y-4">
      <SquadTabs />
      {children}
    </div>
  );
}
