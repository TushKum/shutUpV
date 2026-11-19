"use client";

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FINANCE_ROUTES } from './routes';
import type { ApiEndpointConfig, DeskState, ScreenId } from './types/command';
import {
  DEFAULT_API_CONFIG,
  EQUITY_SERIES,
  INITIAL_DESK_STATE,
  SEED_DIAGNOSTICS,
} from './data/seedData';
import {
  applyMarketTick,
  calculatePortfolioMetrics,
  cancelOpenOrder,
  executeOrder,
  reduceOrClosePosition,
  type OrderRequest,
} from './utils/tradingEngine';
import { TopBar } from './components/TopBar';
import { OverviewScreen } from './components/OverviewScreen';
import { MarketsScreen } from './components/MarketsScreen';
import { PitchArenaScreen } from './components/PitchArenaScreen';
import { RiskTelemetryScreen } from './components/RiskTelemetryScreen';
import { ApiBridgeScreen } from './components/ApiBridgeScreen';
import { CommandPalette } from './components/CommandPalette';
import { NewOrderModal } from './components/NewOrderModal';

const screens = Object.keys(FINANCE_ROUTES) as ScreenId[];
const DeskViews = createContext<Record<ScreenId, ReactNode> | null>(null);

export function FinanceView({ screen }: { screen: ScreenId }) {
  const views = useContext(DeskViews);
  if (!views) throw new Error('FinanceView requires the finance layout.');
  return views[screen];
}

export default function App({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeScreen = screens.find((screen) => FINANCE_ROUTES[screen] === pathname) ?? 'overview';
  const navigate = useCallback((screen: ScreenId) => {
    router.push(FINANCE_ROUTES[screen]);
  }, [router]);
  const [deskState, setDeskState] = useState<DeskState>(INITIAL_DESK_STATE);
  const currentDesk = useRef(deskState);
  const [apiConfig, setApiConfig] = useState<ApiEndpointConfig>(DEFAULT_API_CONFIG);
  const tickStep = useRef(1);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newOrderOpen, setNewOrderOpen] = useState(false);

  // The timer and order handlers share the latest snapshot. Forms need the
  // execution result synchronously, before React commits the next render.
  const updateDesk = useCallback((update: (previous: DeskState) => DeskState) => {
    const next = update(currentDesk.current);
    currentDesk.current = next;
    setDeskState(next);
  }, []);

  // Simulated deterministic live tick stream (pausable from Sidebar or Cmd+K)
  useEffect(() => {
    if (!deskState.isStreaming) return;
    const timer = window.setInterval(() => {
      updateDesk((prev) => ({
        ...prev,
        tickers: applyMarketTick(prev.tickers, tickStep.current++),
      }));
    }, 2400);
    return () => window.clearInterval(timer);
  }, [deskState.isStreaming, updateDesk]);

  // Global keyboard shortcuts: Cmd/Ctrl+K for Command Palette, 1-5 for screens
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setNewOrderOpen(false);
        return;
      }
      if (
        paletteOpen || newOrderOpen || e.ctrlKey || e.metaKey || e.altKey ||
        (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input, textarea, select')))
      ) return;
      const screen = /^[1-5]$/.test(e.key) ? screens[Number(e.key) - 1] : undefined;
      if (screen) {
        navigate(screen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, newOrderOpen, paletteOpen]);

  const metrics = useMemo(
    () =>
      calculatePortfolioMetrics(
        deskState.cash,
        deskState.initialCapital,
        deskState.positions,
        deskState.tickers,
      ),
    [deskState.cash, deskState.initialCapital, deskState.positions, deskState.tickers],
  );

  const handleSelectSymbol = useCallback((symbol: string) => {
    updateDesk((prev) => ({ ...prev, selectedSymbol: symbol }));
  }, [updateDesk]);

  const handleSubmitOrder = useCallback((req: OrderRequest) => {
    const { ok, error, nextState } = executeOrder(currentDesk.current, req);
    updateDesk(() => nextState);
    return { ok, error };
  }, [updateDesk]);

  const handleCancelOrder = useCallback((orderId: string) => {
    updateDesk((prev) => cancelOpenOrder(prev, orderId));
  }, [updateDesk]);

  const handleReducePosition = useCallback((symbol: string, fraction: number) => {
    updateDesk((prev) => reduceOrClosePosition(prev, symbol, fraction).nextState);
  }, [updateDesk]);

  const handleBackTeam = useCallback((teamId: string, amountUsd: number) => {
    updateDesk((prev) => {
      const target = prev.pitchTeams.find((t) => t.id === teamId);
      if (!target || amountUsd <= 0 || amountUsd > prev.cash) return prev;
      return {
        ...prev,
        cash: prev.cash - amountUsd,
        pitchTeams: prev.pitchTeams.map((t) =>
          t.id === teamId
            ? {
                ...t,
                backingTotal: t.backingTotal + amountUsd,
                impliedValuationM: Number((t.impliedValuationM + amountUsd / 125000).toFixed(1)),
                changePct: Number((t.changePct + 0.4).toFixed(2)),
              }
            : t,
        ),
      };
    });
  }, [updateDesk]);

  const handleToggleStreaming = useCallback(() => {
    updateDesk((prev) => ({ ...prev, isStreaming: !prev.isStreaming }));
  }, [updateDesk]);

  const openOrdersCount = deskState.orders.filter((o) => o.status === 'OPEN').length;

  const views: Record<ScreenId, ReactNode> = {
    overview: (
    <>
    <dl className="mb-4 grid gap-2 rounded border border-white/10 bg-[#0C1110] p-3 text-xs leading-relaxed text-[#BACBB9] sm:grid-cols-3">
      <div><dt className="font-semibold text-[#F2F5F3]">Portfolio NAV</dt><dd>What the portfolio is worth at current marks.</dd></div>
      <div><dt className="font-semibold text-[#F2F5F3]">Buying power</dt><dd>How much capacity remains for new positions.</dd></div>
      <div><dt className="font-semibold text-[#F2F5F3]">Margin used</dt><dd>How much capital your open positions tie up.</dd></div>
    </dl>
    <OverviewScreen
      state={deskState}
      metrics={metrics}
      equitySeries={EQUITY_SERIES}
      onSelectSymbol={handleSelectSymbol}
      onSubmitOrder={handleSubmitOrder}
      onNavigateMarkets={() => navigate('markets')}
    />
    </>
    ),
    markets: (
    <MarketsScreen
      state={deskState}
      metrics={metrics}
      onSelectSymbol={handleSelectSymbol}
      onSubmitOrder={handleSubmitOrder}
      onCancelOrder={handleCancelOrder}
    />
    ),
    arena: (
    <PitchArenaScreen
      teams={deskState.pitchTeams}
      cashAvailable={deskState.cash}
      onBackTeam={handleBackTeam}
    />
    ),
    risk: (
    <RiskTelemetryScreen
      state={deskState}
      metrics={metrics}
      diagnostics={SEED_DIAGNOSTICS}
      onReducePosition={handleReducePosition}
    />
    ),
    config: (
    <ApiBridgeScreen
      config={apiConfig}
      state={deskState}
      onUpdateConfig={setApiConfig}
    />
    ),
  };

  return (
    <div className="finance-desk min-w-0 rounded-lg border border-white/10 bg-[#070909] text-[#F2F5F3]">
      <div className="min-w-0">
        <TopBar
          activeScreen={activeScreen}
          onOpenCommandPalette={() => setPaletteOpen(true)}
          onOpenNewOrder={() => setNewOrderOpen(true)}
        />
        <nav aria-label="Finance workspace" className="flex flex-wrap gap-2 border-b border-white/10 p-3">
          {([['overview', 'Portfolio'], ['markets', 'Trade'], ['arena', 'Pitch Arena'], ['risk', 'Risk & Telemetry'], ['config', 'Data settings']] as const).map(([screen, label]) => (
            <Link key={screen} href={FINANCE_ROUTES[screen]} aria-current={activeScreen === screen ? 'page' : undefined}
              className="rounded border border-white/15 px-3 py-1.5 text-xs text-[#BACBB9] aria-[current=page]:border-[#8fddc3] aria-[current=page]:text-[#d7fbee]">
              {label}
            </Link>
          ))}
          <button type="button" onClick={handleToggleStreaming} className="rounded border border-white/15 px-3 py-1.5 text-xs">
            {deskState.isStreaming ? 'Pause prices' : 'Resume prices'}
          </button>
        </nav>

        <p className="border-b border-[#1B2420] bg-[#0C1110] px-4 py-2 font-mono text-xs text-[#BACBB9] lg:px-6">
          Paper trading · {openOrdersCount} open orders · Simulated prices and balances
        </p>
        <div key={pathname} className="p-3 sm:p-4">
          <div className="max-w-[1440px] mx-auto">
            <DeskViews.Provider value={views}>{children}</DeskViews.Provider>
          </div>
        </div>
      </div>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          tickers={deskState.tickers}
          onNavigate={navigate}
          onSelectSymbol={handleSelectSymbol}
          onToggleStream={handleToggleStreaming}
          isStreaming={deskState.isStreaming}
        />
      )}

      <NewOrderModal
        open={newOrderOpen}
        onClose={() => setNewOrderOpen(false)}
        tickers={deskState.tickers}
        selectedSymbol={deskState.selectedSymbol}
        buyingPower={metrics.buyingPower}
        onSelectSymbol={handleSelectSymbol}
        onSubmitOrder={handleSubmitOrder}
      />
    </div>
  );
}
