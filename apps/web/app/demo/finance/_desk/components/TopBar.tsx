import React from 'react';
import { Command, Plus } from 'lucide-react';
import type { ScreenId } from '../types/command';

interface TopBarProps {
  activeScreen: ScreenId;
  onOpenCommandPalette: () => void;
  onOpenNewOrder: () => void;
}

const SCREEN_TITLES: Record<ScreenId, string> = {
  overview: 'Desk Overview',
  markets: 'Markets & Execution',
  arena: 'Pitch Arena',
  risk: 'Risk & Telemetry',
  config: 'API & Desk Config',
};

export const TopBar: React.FC<TopBarProps> = ({
  activeScreen,
  onOpenCommandPalette,
  onOpenNewOrder,
}) => {
  return (
    <header className="h-14 bg-[#0C1110] border-b border-[#1B2420] px-4 lg:px-6 flex items-center justify-between gap-4 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
          <span className="hidden sm:inline font-mono text-xs text-[#87948D] whitespace-nowrap">
            Matrix Command
          </span>
          <span className="hidden sm:inline text-[#3B4A3D]" aria-hidden="true">
            /
          </span>
          <h1 className="font-display font-semibold text-sm text-[#F2F5F3] truncate">
            {SCREEN_TITLES[activeScreen]}
          </h1>
        </nav>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="hidden sm:flex items-center gap-2 h-9 px-3 bg-[#070909] border border-[#1B2420] hover:border-[#285D46] rounded text-xs font-mono text-[#87948D] hover:text-[#F2F5F3] transition-colors whitespace-nowrap shrink-0"
        >
          <Command className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Command</span>
          <kbd className="ml-1 px-1.5 py-0.5 text-[10px] bg-[#101715] border border-[#1B2420] rounded-sm text-[#BACBB9]">
            ⌘K
          </kbd>
        </button>

        <button
          type="button"
          onClick={onOpenNewOrder}
          className="h-9 px-4 bg-[#00E676] hover:bg-[#00B86B] text-[#070909] font-mono text-xs font-semibold uppercase tracking-wide rounded transition-all hover:shadow-[0_0_12px_rgba(0,230,118,0.3)] flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          <span>New Order</span>
        </button>
      </div>
    </header>
  );
};
