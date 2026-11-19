"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageTitle, Panel, Metric } from "../ui";
import { EmptyFilterState } from "../list-filter-bar";

interface StandingRow {
  rank: string;
  team: string;
  track: "PRODUCT" | "CONSULTING" | "FINANCE";
  r1: number;
  r2: number;
  r3: number;
  total: number;
}

const rows: StandingRow[] = [
  { rank: "01", team: "TEAM XP01", track: "PRODUCT", r1: 92, r2: 88, r3: 76, total: 256 },
  { rank: "02", team: "TEAM XC14", track: "CONSULTING", r1: 86, r2: 91, r3: 72, total: 249 },
  { rank: "03", team: "TEAM XF05", track: "FINANCE", r1: 90, r2: 84, r3: 73, total: 247 },
  { rank: "04", team: "TEAM XF01", track: "FINANCE", r1: 82, r2: 86, r3: 78, total: 246 },
  { rank: "05", team: "TEAM XP09", track: "PRODUCT", r1: 88, r2: 79, r3: 74, total: 241 },
  { rank: "06", team: "TEAM XC01", track: "CONSULTING", r1: 82, r2: 87, r3: 71, total: 240 },
  { rank: "07", team: "TEAM XP18", track: "PRODUCT", r1: 86, r2: 80, r3: 72, total: 238 },
  { rank: "08", team: "TEAM XC07", track: "CONSULTING", r1: 88, r2: 78, r3: 70, total: 236 },
  { rank: "09", team: "TEAM XF02", track: "FINANCE", r1: 80, r2: 81, r3: 74, total: 235 },
  { rank: "10", team: "TEAM XP15", track: "PRODUCT", r1: 84, r2: 79, r3: 70, total: 233 },
  { rank: "11", team: "TEAM XC09", track: "CONSULTING", r1: 86, r2: 76, r3: 69, total: 231 },
  { rank: "12", team: "TEAM XF11", track: "FINANCE", r1: 79, r2: 77, r3: 72, total: 228 },
];

export default function Leaderboard() {
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [trackFilter, setTrackFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("RANK");

  const filteredRows = useMemo(() => {
    const list = rows.filter(r => {
      if (teamFilter !== "ALL" && r.team !== teamFilter) return false;
      if (trackFilter !== "ALL" && r.track !== trackFilter) return false;
      return true;
    });
    if (sortBy === "TOTAL_ASC") return [...list].sort((a, b) => a.total - b.total);
    if (sortBy === "R1_DESC") return [...list].sort((a, b) => b.r1 - a.r1);
    if (sortBy === "R2_DESC") return [...list].sort((a, b) => b.r2 - a.r2);
    if (sortBy === "CODE_ASC") return [...list].sort((a, b) => a.team.localeCompare(b.team));
    return list;
  }, [teamFilter, trackFilter, sortBy]);

  const isFiltered = teamFilter !== "ALL" || trackFilter !== "ALL" || sortBy !== "RANK";
  const reset = () => {
    setTeamFilter("ALL");
    setTrackFilter("ALL");
    setSortBy("RANK");
  };

  return (
    <>
      <PageTitle
        eyebrow="GLOBAL RANKINGS / OUT OF 300"
        title="Leaderboard."
        sub="Live ranking until the market freeze. After the freeze, the ranking stays hidden until awards are revealed one at a time."
      />
      <div className="guide-grid three">
        <Metric label="TEAMS" value="150" delta="THREE TRACKS" />
        <Metric label="YOUR POSITION" value="#04" delta="ILLUSTRATIVE PREVIEW" />
        <Metric label="TOP TOTAL" value="256 / 300" delta="ROUND 1 + ROUND 2 + ROUND 3" />
      </div>
      <div className="mt-4">
        <Panel title="Overall standings" tag="PRE-FREEZE · SAMPLE DATA">
          <div className="guide-filter-bar" role="region" aria-label="Leaderboard filters">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div>
                <label htmlFor="lb-team-filter" className="guide-label">TEAM CODE</label>
                <select
                  id="lb-team-filter"
                  className="guide-select guide-filter-control font-mono"
                  value={teamFilter}
                  onChange={e => {
                    const next = e.target.value;
                    setTeamFilter(next);
                    if (next !== "ALL") setTrackFilter("ALL");
                  }}
                >
                  <option value="ALL">All Teams ({rows.length})</option>
                  {rows.map(r => (
                    <option key={r.team} value={r.team}>
                      #{r.rank} · {r.team} ({r.track} · {r.total} pts)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="lb-track-filter" className="guide-label">TRACK</label>
                <select
                  id="lb-track-filter"
                  className="guide-select guide-filter-control font-mono"
                  value={trackFilter}
                  onChange={e => {
                    const next = e.target.value;
                    setTrackFilter(next);
                    if (next !== "ALL") setTeamFilter("ALL");
                  }}
                >
                  <option value="ALL">All Tracks</option>
                  <option value="PRODUCT">PRODUCT</option>
                  <option value="CONSULTING">CONSULTING</option>
                  <option value="FINANCE">FINANCE</option>
                </select>
              </div>
              <div>
                <label htmlFor="lb-sort-filter" className="guide-label">SORT BY</label>
                <select
                  id="lb-sort-filter"
                  className="guide-select guide-filter-control font-mono"
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                >
                  <option value="RANK">Rank / Total High → Low</option>
                  <option value="TOTAL_ASC">Total Low → High</option>
                  <option value="R1_DESC">Round 1 Score High → Low</option>
                  <option value="R2_DESC">Round 2 Score High → Low</option>
                  <option value="CODE_ASC">Team Code: A → Z</option>
                </select>
              </div>
            </div>
            <div className="guide-filter-meta">
              <span className="guide-muted !text-[10px] font-mono">
                SHOWING <b>{filteredRows.length}</b> OF <b>{rows.length}</b> TEAMS
                {teamFilter !== "ALL" && ` · ${teamFilter}`}
                {trackFilter !== "ALL" && ` · ${trackFilter}`}
              </span>
              <div className="flex items-center gap-2">
                {filteredRows.length > 1 && (
                  <span className="guide-muted !text-[9px] font-mono">↕ SCROLL INSIDE BOX (MAX 8 VISIBLE)</span>
                )}
                {isFiltered && (
                  <button type="button" className="guide-btn secondary guide-filter-reset" onClick={reset}>
                    RESET FILTERS
                  </button>
                )}
              </div>
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <EmptyFilterState noun="teams" onReset={reset} />
          ) : (
            <div className="guide-scroll-box table-8">
              <table className="guide-table">
                <thead>
                  <tr>
                    {["RANK", "TEAM", "TRACK", "R1 / 100", "R2 / 100", "R3 / 100", "TOTAL / 300"].map(x => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(r => (
                    <tr key={r.team}>
                      <td>{r.rank}</td>
                      <td>{r.team}</td>
                      <td>{r.track}</td>
                      <td>{r.r1}</td>
                      <td>{r.r2}</td>
                      <td>{r.r3}</td>
                      <td>{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <div className="guide-grid two mt-4">
        <Panel title="Points vs. portfolio return">
          <p className="guide-muted">
            Round 3 points contribute up to 100 of the 300 event points. For example, the leading sample team has 92 + 88 + 76 = 256 points. Its 76 trading points do not mean a 76% return. Exact Round 3 return is used only if the first two tie-breakers are also tied.
          </p>
          <Link className="guide-chip mt-3 inline-block" href="/demo/finance">
            See how the desk measures portfolio return
          </Link>
        </Panel>
        <Panel title="Tie-break order" tag="OFFICIAL RULE">
          <p className="guide-muted">1. Higher Round 2 score.</p>
          <p className="guide-muted mt-2">2. Higher Round 1 score.</p>
          <p className="guide-muted mt-2">3. Higher exact Round 3 return.</p>
        </Panel>
        <Panel title="Awards" tag="REVEALED ONE BY ONE">
          <p className="guide-muted">Winner, runner-up, third place · Best PRD · Best crisis solution · Best investor · Best company.</p>
          <p className="guide-muted mt-2">Every participant receives a certificate after the event.</p>
        </Panel>
      </div>
    </>
  );
}
