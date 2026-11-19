"use client";
import { useId } from "react";

export interface TeamFilterOption {
  code: string;
  label: string;
}

export interface AmountPresetOption {
  value: string;
  label: string;
}

export interface SortOption {
  value: string;
  label: string;
}

export interface ListFilterState {
  teamCode: string;
  amountFilter: string;
  minAmount: string;
  maxAmount: string;
  sortBy: string;
}

export const INITIAL_LIST_FILTER: ListFilterState = {
  teamCode: "ALL",
  amountFilter: "ALL",
  minAmount: "",
  maxAmount: "",
  sortBy: "DEFAULT",
};

export function isListFilterActive(state: ListFilterState): boolean {
  return (
    state.teamCode !== "ALL" ||
    state.amountFilter !== "ALL" ||
    state.minAmount.trim() !== "" ||
    state.maxAmount.trim() !== "" ||
    state.sortBy !== "DEFAULT"
  );
}

export function matchesAmountFilter(amount: number, state: ListFilterState): boolean {
  const f = state.amountFilter;
  if (f !== "ALL") {
    if (f.startsWith("EXACT:")) {
      const target = Number(f.slice(6));
      if (!Number.isNaN(target) && Math.abs(amount - target) > 0.001) return false;
    } else if (f.startsWith("GTE:")) {
      const target = Number(f.slice(4));
      if (!Number.isNaN(target) && amount < target - 0.001) return false;
    } else if (f.startsWith("LTE:")) {
      const target = Number(f.slice(4));
      if (!Number.isNaN(target) && amount > target + 0.001) return false;
    } else if (f.startsWith("RANGE:")) {
      const parts = f.slice(6).split(":");
      const lo = Number(parts[0]);
      const hi = Number(parts[1]);
      if (!Number.isNaN(lo) && amount < lo - 0.001) return false;
      if (!Number.isNaN(hi) && amount > hi + 0.001) return false;
    }
  }

  const minRaw = state.minAmount.trim();
  if (minRaw !== "") {
    const min = Number(minRaw);
    if (!Number.isNaN(min) && amount < min - 0.001) return false;
  }

  const maxRaw = state.maxAmount.trim();
  if (maxRaw !== "") {
    const max = Number(maxRaw);
    if (!Number.isNaN(max) && amount > max + 0.001) return false;
  }

  return true;
}

export function buildEquityRanges(): AmountPresetOption[] {
  return [
    { value: "GTE:3", label: "≥ 3.0% Equity (≥ 3,000 sh)" },
    { value: "GTE:3.5", label: "≥ 3.5% Equity (≥ 3,500 sh)" },
    { value: "GTE:4", label: "≥ 4.0% Equity (≥ 4,000 sh)" },
    { value: "GTE:4.5", label: "≥ 4.5% Equity (≥ 4,500 sh)" },
    { value: "RANGE:3:4", label: "3.0% – 4.0% Equity (3,000–4,000 sh)" },
    { value: "LTE:3", label: "≤ 3.0% Equity (≤ 3,000 sh)" },
    { value: "LTE:3.5", label: "≤ 3.5% Equity (≤ 3,500 sh)" },
    { value: "LTE:4", label: "≤ 4.0% Equity (≤ 4,000 sh)" },
  ];
}

export function buildDealAmountRanges(): AmountPresetOption[] {
  return [
    { value: "GTE:35000", label: "≥ $35,000 (At least $35,000)" },
    { value: "GTE:40000", label: "≥ $40,000 (At least $40,000)" },
    { value: "GTE:45000", label: "≥ $45,000 (At least $45,000)" },
    { value: "RANGE:35000:45000", label: "$35,000 – $45,000" },
    { value: "LTE:35000", label: "≤ $35,000 (Up to $35,000)" },
    { value: "LTE:40000", label: "≤ $40,000 (Up to $40,000)" },
    { value: "LTE:45000", label: "≤ $45,000 (Up to $45,000)" },
  ];
}

export function buildCapitalAmountRanges(): AmountPresetOption[] {
  return [
    { value: "GTE:400000", label: "≥ $400,000" },
    { value: "GTE:450000", label: "≥ $450,000" },
    { value: "GTE:500000", label: "≥ $500,000" },
    { value: "RANGE:400000:500000", label: "$400,000 – $500,000" },
    { value: "LTE:450000", label: "≤ $450,000" },
  ];
}

export function buildDraftCashRanges(): AmountPresetOption[] {
  return [
    { value: "LTE:25000", label: "≤ $25,000 (Lowest Cash)" },
    { value: "LTE:35000", label: "≤ $35,000" },
    { value: "RANGE:35000:45000", label: "$35,000 – $45,000" },
    { value: "GTE:35000", label: "≥ $35,000" },
    { value: "GTE:45000", label: "≥ $45,000" },
  ];
}

export function uniqueSortedAmounts(amounts: number[]): number[] {
  return Array.from(new Set(amounts)).sort((a, b) => a - b);
}

interface ListFilterBarProps {
  value: ListFilterState;
  onChange: (next: ListFilterState) => void;
  teamOptions: TeamFilterOption[];
  teamLabel?: string;
  allTeamsLabel?: string;
  showAmountFilter?: boolean;
  valueKind?: "CURRENCY" | "EQUITY";
  amountLabel?: string;
  amountRanges?: AmountPresetOption[];
  exactAmounts?: number[];
  minPlaceholder?: string;
  maxPlaceholder?: string;
  sortOptions?: SortOption[];
  totalCount: number;
  filteredCount: number;
  itemNoun?: string;
  resetOnTeamSelect?: boolean;
}

const DEFAULT_SORT_OPTIONS: SortOption[] = [
  { value: "DEFAULT", label: "Default Order" },
  { value: "AMOUNT_DESC", label: "Amount: High → Low" },
  { value: "AMOUNT_ASC", label: "Amount: Low → High" },
  { value: "CODE_ASC", label: "Team Code: A → Z" },
];

function formatAmountFilterTag(f: string, valueKind: "CURRENCY" | "EQUITY"): string {
  const fmt = (n: number) =>
    valueKind === "EQUITY" ? `${n}%` : `$${n.toLocaleString()}`;
  if (f.startsWith("EXACT:")) return `= ${fmt(Number(f.slice(6)))}`;
  if (f.startsWith("GTE:")) return `≥ ${fmt(Number(f.slice(4)))}`;
  if (f.startsWith("LTE:")) return `≤ ${fmt(Number(f.slice(4)))}`;
  if (f.startsWith("RANGE:")) {
    const [lo, hi] = f.slice(6).split(":");
    return `${fmt(Number(lo))}–${fmt(Number(hi))}`;
  }
  return f;
}

export function ListFilterBar({
  value,
  onChange,
  teamOptions,
  teamLabel = "TEAM CODE",
  allTeamsLabel = "All Teams",
  showAmountFilter = true,
  valueKind = "CURRENCY",
  amountLabel,
  amountRanges,
  exactAmounts = [],
  minPlaceholder,
  maxPlaceholder,
  sortOptions = DEFAULT_SORT_OPTIONS,
  totalCount,
  filteredCount,
  itemNoun = "teams",
  resetOnTeamSelect = true,
}: ListFilterBarProps) {
  const uid = useId();
  const active = isListFilterActive(value);
  const isEquity = valueKind === "EQUITY";
  const resolvedAmountLabel = amountLabel ?? (isEquity ? "EQUITY % / SHARES FILTER" : "AMOUNT FILTER");
  const resolvedRanges = amountRanges ?? (isEquity ? buildEquityRanges() : buildDealAmountRanges());
  const resolvedMinPh = minPlaceholder ?? (isEquity ? "e.g. 3" : "e.g. 35000");
  const resolvedMaxPh = maxPlaceholder ?? (isEquity ? "e.g. 4.5" : "e.g. 45000");

  const handleTeamChange = (nextCode: string) => {
    if (resetOnTeamSelect && nextCode !== "ALL") {
      onChange({
        ...value,
        teamCode: nextCode,
        amountFilter: "ALL",
        minAmount: "",
        maxAmount: "",
      });
    } else {
      onChange({ ...value, teamCode: nextCode });
    }
  };

  const handleAmountPresetChange = (nextPreset: string) => {
    onChange({
      ...value,
      teamCode: nextPreset !== "ALL" ? "ALL" : value.teamCode,
      amountFilter: nextPreset,
      minAmount: "",
      maxAmount: "",
    });
  };

  const handleMinChange = (nextMin: string) => {
    onChange({
      ...value,
      teamCode: nextMin.trim() !== "" ? "ALL" : value.teamCode,
      amountFilter: "ALL",
      minAmount: nextMin,
    });
  };

  const handleMaxChange = (nextMax: string) => {
    onChange({
      ...value,
      teamCode: nextMax.trim() !== "" ? "ALL" : value.teamCode,
      amountFilter: "ALL",
      maxAmount: nextMax,
    });
  };

  const handleSortChange = (nextSort: string) => {
    onChange({ ...value, sortBy: nextSort });
  };

  return (
    <div className="guide-filter-bar" role="region" aria-label={`${teamLabel} and ${resolvedAmountLabel} controls`}>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-team`} className="guide-label">
            {teamLabel}
          </label>
          <select
            id={`${uid}-team`}
            className="guide-select guide-filter-control font-mono"
            value={value.teamCode}
            onChange={e => handleTeamChange(e.target.value)}
          >
            <option value="ALL">
              {allTeamsLabel} ({totalCount})
            </option>
            {teamOptions.map(opt => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {showAmountFilter ? (
          <div>
            <label htmlFor={`${uid}-amount`} className="guide-label">
              {resolvedAmountLabel}
            </label>
            <select
              id={`${uid}-amount`}
              className="guide-select guide-filter-control font-mono"
              value={value.amountFilter}
              onChange={e => handleAmountPresetChange(e.target.value)}
            >
              <option value="ALL">{isEquity ? "All Equity % / Shares" : "All Amounts"}</option>
              {exactAmounts.length > 0 && (
                <optgroup label={isEquity ? "Exact Equity % (Shares)" : "Exact Amount"}>
                  {exactAmounts.map(amt => (
                    <option key={`EXACT:${amt}`} value={`EXACT:${amt}`}>
                      {isEquity
                        ? `Exact: ${amt}% (${Math.round((amt / 100) * 100_000).toLocaleString()} sh)`
                        : `Exact: $${amt.toLocaleString()}`}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={isEquity ? "Equity % Ranges" : "Amount Ranges"}>
                {resolvedRanges.map(preset => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        ) : (
          <div>
            <label htmlFor={`${uid}-sort-only`} className="guide-label">
              SORT BY
            </label>
            <select
              id={`${uid}-sort-only`}
              className="guide-select guide-filter-control font-mono"
              value={value.sortBy}
              onChange={e => handleSortChange(e.target.value)}
            >
              {sortOptions.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {showAmountFilter && (
        <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <div>
            <label htmlFor={`${uid}-min`} className="guide-label">
              {isEquity ? "MIN EQUITY (%)" : "MIN AMOUNT ($)"}
            </label>
            <input
              id={`${uid}-min`}
              type="number"
              min={0}
              step={isEquity ? 0.5 : 1000}
              className="guide-input guide-filter-control font-mono"
              placeholder={resolvedMinPh}
              value={value.minAmount}
              onChange={e => handleMinChange(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-max`} className="guide-label">
              {isEquity ? "MAX EQUITY (%)" : "MAX AMOUNT ($)"}
            </label>
            <input
              id={`${uid}-max`}
              type="number"
              min={0}
              step={isEquity ? 0.5 : 1000}
              className="guide-input guide-filter-control font-mono"
              placeholder={resolvedMaxPh}
              value={value.maxAmount}
              onChange={e => handleMaxChange(e.target.value)}
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor={`${uid}-sort`} className="guide-label">
              SORT BY
            </label>
            <select
              id={`${uid}-sort`}
              className="guide-select guide-filter-control font-mono"
              value={value.sortBy}
              onChange={e => handleSortChange(e.target.value)}
            >
              {sortOptions.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="guide-filter-meta">
        <span className="guide-muted !text-[10px] font-mono">
          SHOWING <b>{filteredCount}</b> OF <b>{totalCount}</b> {itemNoun.toUpperCase()}
          {value.teamCode !== "ALL" && ` · TEAM ${value.teamCode}`}
          {value.amountFilter !== "ALL" && ` · ${formatAmountFilterTag(value.amountFilter, valueKind)}`}
          {value.minAmount.trim() !== "" && ` · MIN ${isEquity ? `${value.minAmount}%` : `$${Number(value.minAmount).toLocaleString()}`}`}
          {value.maxAmount.trim() !== "" && ` · MAX ${isEquity ? `${value.maxAmount}%` : `$${Number(value.maxAmount).toLocaleString()}`}`}
        </span>
        <div className="flex items-center gap-2">
          {filteredCount > 1 && (
            <span className="guide-muted !text-[9px] font-mono">↕ SCROLL INSIDE BOX</span>
          )}
          {active && (
            <button
              type="button"
              className="guide-btn secondary guide-filter-reset"
              onClick={() => onChange(INITIAL_LIST_FILTER)}
            >
              RESET FILTERS
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyFilterState({
  noun = "teams",
  onReset,
}: {
  noun?: string;
  onReset: () => void;
}) {
  return (
    <div className="border border-[#294832] p-4 text-center">
      <p className="guide-muted">
        No {noun} match the selected team code or filter criteria.
      </p>
      <button type="button" className="guide-btn secondary mt-3" onClick={onReset}>
        SHOW ALL {noun.toUpperCase()}
      </button>
    </div>
  );
}
