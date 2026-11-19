import React from 'react';
import Link from 'next/link';
import { FINANCE_ROUTES } from '../routes';
import {
  Activity,
  BarChart3,
  LayoutGrid,
  ShieldAlert,
  Terminal,
  Trophy,
  X,
} from 'lucide-react';
import type { ScreenId } from '../types/command';

interface SidebarProps {
  activeScreen: ScreenId;
  isStreaming: boolean;
  onToggleStreaming: () => void;
  openOrdersCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: {
  id: ScreenId;
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'overview', label: 'Desk Overview', shortcut: '1', icon: LayoutGrid },
  { id: 'markets', label: 'Markets & Execution', shortcut: '2', icon: BarChart3 },
  { id: 'arena', label: 'Pitch Arena', shortcut: '3', icon: Trophy },
  { id: 'risk', label: 'Risk & Telemetry', shortcut: '4', icon: ShieldAlert },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeScreen,
  isStreaming,
  onToggleStreaming,
  openOrdersCount,
  mobileOpen,
  onCloseMobile,
}) => {
  const navContent = (
    <div className="flex flex-col h-full bg-[#0C1110] border-r border-[#1B2420] w-[240px] shrink-0">
      <div className="h-14 px-4 flex items-center justify-between border-b border-[#1B2420]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-[#101715] border border-[#285D46] flex items-center justify-center text-[#00E676]">
            <Terminal className="w-4 h-4" aria-hidden="true" />
          </div>
          <span className="font-display font-semibold text-sm tracking-tight text-[#F2F5F3] whitespace-nowrap">
            Matrix Command
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden p-2 text-[#87948D] hover:text-[#F2F5F3] rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 flex-1 overflow-y-auto">
        <div className="px-2 pb-2 text-[10px] font-mono font-semibold tracking-[0.08em] uppercase text-[#87948D]">
          Command Views
        </div>
        <nav aria-label="Primary workspace navigation" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeScreen === item.id;
            return (
              <Link
                key={item.id}
                href={FINANCE_ROUTES[item.id]}
                onNavigate={onCloseMobile}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded text-left text-[13px] font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#151D19] text-[#F2F5F3] border border-[#285D46] shadow-[0_0_8px_rgba(0,230,118,0.12)]'
                    : 'text-[#87948D] hover:text-[#F2F5F3] hover:bg-[#101715] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      active ? 'text-[#00E676]' : 'text-[#87948D]'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="font-mono text-[10px] text-[#87948D] ml-2 shrink-0">
                  {item.id === 'markets' && openOrdersCount > 0
                    ? `${openOrdersCount}`
                    : item.shortcut}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 pt-4 border-t border-[#1B2420]">
          <div className="px-2 pb-2 text-[10px] font-mono font-semibold tracking-[0.08em] uppercase text-[#87948D]">
            Competition Window
          </div>
          <div className="bg-[#101715] border border-white/[0.07] rounded p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-[#87948D]">Round 03</span>
              <span className="text-[11px] font-mono text-[#00D68F] tabular-nums">
                04:18:42 left
              </span>
            </div>
            <div className="h-1.5 w-full bg-[#070909] rounded-sm overflow-hidden">
              <div className="h-full w-[72%] bg-[#00E676]" />
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-[#87948D]">
              <span>Desk Rank</span>
              <span className="text-[#F2F5F3] font-semibold tabular-nums">#2 / 48</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-3 border-t border-[#1B2420] space-y-2">
        <Link href="/demo/dashboard" className="block rounded px-3 py-2 font-mono text-xs text-[#BACBB9] hover:bg-[#101715]">
          ← PRIMUS dashboard
        </Link>
        <button
          type="button"
          onClick={onToggleStreaming}
          className="w-full flex items-center justify-between px-3 py-2 rounded bg-[#101715] border border-[#1B2420] hover:border-[#285D46] transition-colors text-xs font-mono"
        >
          <span className="flex items-center gap-2 text-[#F2F5F3]">
            {isStreaming ? (
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00E676] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00E676]" />
              </span>
            ) : (
              <span className="inline-flex rounded-full h-2 w-2 bg-[#87948D]" aria-hidden="true" />
            )}
            <span>{isStreaming ? 'Feed Live' : 'Feed Paused'}</span>
          </span>
          <Activity className="w-3.5 h-3.5 text-[#87948D]" aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0">{navContent}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{navContent}</div>
        </div>
      )}
    </>
  );
};
