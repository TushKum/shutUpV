import React from 'react';
import { X } from 'lucide-react';
import type { MarketTicker } from '../types/command';
import type { OrderRequest } from '../utils/tradingEngine';
import { QuickOrderForm } from './QuickOrderForm';

interface NewOrderModalProps {
  open: boolean;
  onClose: () => void;
  tickers: MarketTicker[];
  selectedSymbol: string;
  buyingPower: number;
  onSelectSymbol: (symbol: string) => void;
  onSubmitOrder: (req: OrderRequest) => { ok: boolean; error?: string };
}

export const NewOrderModal: React.FC<NewOrderModalProps> = ({
  open,
  onClose,
  tickers,
  selectedSymbol,
  buyingPower,
  onSelectSymbol,
  onSubmitOrder,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-label="New Order Ticket"
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md bg-[#201e14] border border-[color:var(--desk-accent-line)] rounded-lg shadow-[0_0_16px_var(--desk-accent-soft)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2d2a1d] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#F2F5F3]">
            Direct Execution Ticket
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close order modal"
            className="p-1.5 text-[#87948D] hover:text-[#F2F5F3] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3">
          <QuickOrderForm
            tickers={tickers}
            selectedSymbol={selectedSymbol}
            buyingPower={buyingPower}
            onSelectSymbol={onSelectSymbol}
            onSubmitOrder={(req) => {
              const res = onSubmitOrder(req);
              if (res.ok) {
                setTimeout(onClose, 350);
              }
              return res;
            }}
          />
        </div>
      </div>
    </div>
  );
};
