import React, { useState } from 'react';
import type { PitchTeam } from '../types/command';
import {
  formatCompactCurrency,
  formatCurrency,
  formatSignedPercent,
} from '../utils/tradingEngine';
import { Sparkline } from './Sparkline';

interface PitchArenaScreenProps {
  teams: PitchTeam[];
  cashAvailable: number;
  onBackTeam: (teamId: string, amountUsd: number) => void;
}

export const PitchArenaScreen: React.FC<PitchArenaScreenProps> = ({
  teams,
  cashAvailable,
  onBackTeam,
}) => {
  const [selectedId, setSelectedId] = useState<string>(teams[0]?.id ?? '');
  const [stakeInput, setStakeInput] = useState<string>('15000');
  const [feedback, setFeedback] = useState<string | null>(null);

  const selectedTeam = teams.find((t) => t.id === selectedId) ?? teams[0];

  const handleBack = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(stakeInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFeedback('Enter a positive capital allocation amount.');
      return;
    }
    if (amount > cashAvailable) {
      setFeedback(`Insufficient available cash (${formatCurrency(cashAvailable, 0)}).`);
      return;
    }
    onBackTeam(selectedTeam.id, amount);
    setFeedback(`Allocated ${formatCurrency(amount, 0)} backing to ${selectedTeam.ticker}.`);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Leaderboard Table (7 cols) */}
        <section className="xl:col-span-7 bg-[#171610] border border-white/[0.07] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[#2d2a1d] flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[#F2F5F3]">
                Live Venture Pitch Order Book
              </h2>
              <p className="text-xs text-[#87948D] mt-0.5">
                Overnight founder teams priced dynamically by syndicate conviction.
              </p>
            </div>
            <span className="font-mono text-xs text-[#00D68F] whitespace-nowrap">
              {teams.length} Teams Active
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#2d2a1d] bg-[#11110d]">
                  <th className="py-2.5 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
                    Rank / Team
                  </th>
                  <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                    Implied Val
                  </th>
                  <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                    Syndicate Pool
                  </th>
                  <th className="py-2.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                    24h Delta
                  </th>
                  <th className="py-2.5 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] text-right">
                    Curve
                  </th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team, idx) => {
                  const isSelected = team.id === selectedTeam.id;
                  return (
                    <tr
                      key={team.id}
                      onClick={() => {
                        setSelectedId(team.id);
                        setFeedback(null);
                      }}
                      className={`border-b border-[#2d2a1d]/70 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[#201e14]'
                          : idx % 2 === 0
                            ? 'bg-[#11110d] hover:bg-[#201e14]/70'
                            : 'bg-[#171610] hover:bg-[#201e14]/70'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs text-[#87948D] w-5 tabular-nums">
                            0{idx + 1}
                          </span>
                          <div>
                            <div className="font-mono text-[13px] font-semibold text-[#F2F5F3]">
                              {team.name}{' '}
                              <span className="text-[color:var(--desk-accent)] font-normal ml-1">
                                {team.ticker}
                              </span>
                            </div>
                            <div className="text-xs text-[#87948D]">
                              {team.founder} · {team.institution}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono text-[13px] text-[#F2F5F3] text-right tabular-nums">
                        ${team.impliedValuationM.toFixed(1)}M
                      </td>
                      <td className="py-3 px-3 font-mono text-[13px] text-[#BACBB9] text-right tabular-nums">
                        {formatCompactCurrency(team.backingTotal)}
                      </td>
                      <td
                        className={`py-3 px-3 font-mono text-[13px] text-right tabular-nums ${
                          team.changePct >= 0 ? 'text-[#00D68F]' : 'text-[#FF5364]'
                        }`}
                      >
                        {formatSignedPercent(team.changePct)}
                      </td>
                      <td className="py-3 px-4 flex justify-end">
                        <Sparkline
                          values={team.sparkline}
                          positive={team.changePct >= 0}
                          width={72}
                          height={22}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Diligence Brief & Backing Execution (5 cols) */}
        <section className="xl:col-span-5 bg-[#171610] border border-white/[0.07] rounded-lg p-5 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#2d2a1d]">
              <div>
                <div className="font-mono text-[11px] text-[#87948D]">
                  {selectedTeam.pitchSlot} · {selectedTeam.sector}
                </div>
                <h2 className="text-lg font-semibold text-[#F2F5F3] mt-1">
                  {selectedTeam.name} ({selectedTeam.ticker})
                </h2>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#87948D]">
                  Judge Rubric
                </div>
                <div className="font-mono text-lg font-semibold text-[color:var(--desk-accent)] tabular-nums">
                  {selectedTeam.judgesScore.toFixed(1)} / 10
                </div>
              </div>
            </div>

            <div className="space-y-3 text-[13px] leading-relaxed">
              <div>
                <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-1">
                  Investment Thesis
                </h3>
                <p className="text-[#F2F5F3]">{selectedTeam.thesisSummary}</p>
              </div>

              <div className="pt-2 border-t border-[#2d2a1d]">
                <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-1">
                  Technical Moat
                </h3>
                <p className="text-[#BACBB9]">{selectedTeam.moat}</p>
              </div>

              <div className="pt-2 border-t border-[#2d2a1d]">
                <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-1">
                  Unit Economics
                </h3>
                <p className="text-[#BACBB9]">{selectedTeam.unitEconomics}</p>
              </div>

              <div className="pt-2 border-t border-[#2d2a1d]">
                <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-1">
                  Primary Downside Risk
                </h3>
                <p className="text-[#FF5364]">{selectedTeam.riskFactor}</p>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleBack}
            className="pt-4 border-t border-[#2d2a1d] space-y-3"
          >
            <div className="flex items-center justify-between text-xs font-mono">
              <label
                htmlFor="arena-stake"
                className="uppercase tracking-[0.08em] text-[#87948D]"
              >
                Syndicate Allocation (USD)
              </label>
              <span className="text-[#87948D] tabular-nums">
                Cash: {formatCurrency(cashAvailable, 0)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="arena-stake"
                type="number"
                min="500"
                step="500"
                value={stakeInput}
                onChange={(e) => {
                  setStakeInput(e.target.value);
                  setFeedback(null);
                }}
                className="min-w-0 flex-1 h-10 px-3 bg-[#11110d] border border-[#2d2a1d] focus:border-[color:var(--desk-accent)] focus:outline-none rounded font-mono text-sm text-[#F2F5F3] tabular-nums"
              />
              <button
                type="submit"
                className="h-10 px-5 bg-[var(--desk-accent)] hover:bg-[var(--desk-accent-hover)] text-[#070909] font-mono text-xs font-semibold uppercase tracking-wider rounded transition-all hover:shadow-[0_0_12px_var(--desk-accent-soft)] whitespace-nowrap shrink-0"
              >
                Back {selectedTeam.ticker}
              </button>
            </div>

            {feedback && (
              <div
                role="status"
                className="px-3 py-2 rounded bg-[var(--desk-accent-soft)] border border-[color:var(--desk-accent-line)] font-mono text-xs text-[#75FF9E]"
              >
                {feedback}
              </div>
            )}
          </form>
        </section>
      </div>
    </div>
  );
};
