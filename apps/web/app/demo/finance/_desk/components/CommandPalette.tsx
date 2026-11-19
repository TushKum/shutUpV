import React, { useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import type { MarketTicker, ScreenId } from '../types/command';
import { formatCurrency } from '../utils/tradingEngine';

interface CommandPaletteProps {
  onClose: () => void;
  tickers: MarketTicker[];
  onNavigate: (screen: ScreenId) => void;
  onSelectSymbol: (symbol: string) => void;
  onToggleStream: () => void;
  isStreaming: boolean;
}

const SCREENS: { id: ScreenId; label: string; hint: string }[] = [
  { id: 'overview', label: 'Desk Overview', hint: 'NAV, Equity Curve & Positions' },
  { id: 'markets', label: 'Markets & Execution', hint: 'Screener, Order Book & Blotter' },
  { id: 'arena', label: 'Pitch Arena', hint: 'Competing Startups & Backing' },
  { id: 'risk', label: 'Risk & Telemetry', hint: 'VaR, Liquidation & Feeds' },
];

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  onClose,
  tickers,
  onNavigate,
  onSelectSymbol,
  onToggleStream,
  isStreaming,
}) => {
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const matchedScreens = SCREENS.filter(
    (s) =>
      !q ||
      s.label.toLowerCase().includes(q) ||
      s.hint.toLowerCase().includes(q),
  );
  const matchedTickers = tickers.filter(
    (t) =>
      !q ||
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-xl bg-[#201e14] border border-[color:var(--desk-accent-line)] rounded-lg shadow-[0_0_16px_var(--desk-accent-soft)] overflow-hidden">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-[#2d2a1d]">
          <Search className="w-4 h-4 text-[color:var(--desk-accent)] shrink-0" aria-hidden="true" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to screen, instrument, or desk action..."
            aria-label="Command search"
            className="flex-1 bg-transparent text-sm font-mono text-[#F2F5F3] placeholder:text-[#87948D] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="p-1.5 text-[#87948D] hover:text-[#F2F5F3] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-2 space-y-3">
          {matchedScreens.length > 0 && (
            <div>
              <div className="px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
                Screens
              </div>
              <div className="space-y-0.5">
                {matchedScreens.map((screen) => (
                  <button
                    key={screen.id}
                    type="button"
                    onClick={() => {
                      onNavigate(screen.id);
                      onClose();
                    }}
                    className="w-full px-3 py-2 rounded flex items-center justify-between text-left hover:bg-[#171610] transition-colors"
                  >
                    <div>
                      <div className="text-xs font-medium text-[#F2F5F3]">{screen.label}</div>
                      <div className="text-[11px] font-mono text-[#87948D]">{screen.hint}</div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-[#87948D]" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchedTickers.length > 0 && (
            <div>
              <div className="px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
                Instruments
              </div>
              <div className="space-y-0.5">
                {matchedTickers.slice(0, 5).map((ticker) => (
                  <button
                    key={ticker.symbol}
                    type="button"
                    onClick={() => {
                      onSelectSymbol(ticker.symbol);
                      onNavigate('markets');
                      onClose();
                    }}
                    className="w-full px-3 py-2 rounded flex items-center justify-between text-left hover:bg-[#171610] transition-colors font-mono text-xs"
                  >
                    <span className="text-[#F2F5F3] font-semibold">
                      {ticker.symbol}{' '}
                      <span className="font-normal text-[#87948D] ml-1.5">{ticker.name}</span>
                    </span>
                    <span className="text-[color:var(--desk-accent)] tabular-nums">
                      {formatCurrency(ticker.price, ticker.price < 2 ? 3 : 2)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">
              Actions
            </div>
            <button
              type="button"
              onClick={() => {
                onToggleStream();
                onClose();
              }}
              className="w-full px-3 py-2 rounded flex items-center justify-between text-left hover:bg-[#171610] transition-colors font-mono text-xs text-[#F2F5F3]"
            >
              <span>{isStreaming ? 'Pause Live Market Stream' : 'Resume Live Market Stream'}</span>
              <span className="text-[#87948D]">Toggle</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
