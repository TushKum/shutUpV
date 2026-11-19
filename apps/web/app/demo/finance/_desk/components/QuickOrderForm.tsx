import React, { useId, useState } from 'react';
import type { MarketTicker, OrderSide, OrderType } from '../types/command';
import type { OrderRequest } from '../utils/tradingEngine';
import { formatCurrency } from '../utils/tradingEngine';

interface QuickOrderFormProps {
  tickers: MarketTicker[];
  selectedSymbol: string;
  buyingPower: number;
  onSelectSymbol: (symbol: string) => void;
  onSubmitOrder: (req: OrderRequest) => { ok: boolean; error?: string };
  compact?: boolean;
}

export const QuickOrderForm: React.FC<QuickOrderFormProps> = ({
  tickers,
  selectedSymbol,
  buyingPower,
  onSelectSymbol,
  onSubmitOrder,
  compact = false,
}) => {
  const formId = useId();
  const [side, setSide] = useState<OrderSide>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [qtyInput, setQtyInput] = useState<string>('25');
  const [limitDraft, setLimitDraft] = useState<{ symbol: string; value: string }>();
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const activeTicker = tickers.find((t) => t.symbol === selectedSymbol) ?? tickers[0];

  const limitPriceInput = limitDraft?.symbol === activeTicker.symbol
    ? limitDraft.value
    : String(activeTicker.price);

  const parsedQty = Number(qtyInput);
  const effectivePrice =
    orderType === 'LIMIT' ? Number(limitPriceInput || activeTicker.price) : activeTicker.price;
  const estNotional =
    Number.isFinite(parsedQty) && parsedQty > 0 && Number.isFinite(effectivePrice)
      ? parsedQty * effectivePrice
      : 0;

  const applyPresetPct = (pct: number) => {
    const budget = buyingPower * pct * 0.35;
    const rawQty = budget / Math.max(0.01, effectivePrice);
    const formatted =
      activeTicker.price >= 1000
        ? rawQty.toFixed(2)
        : Math.max(1, Math.floor(rawQty)).toString();
    setQtyInput(formatted);
    setFeedback(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = onSubmitOrder({
      symbol: activeTicker.symbol,
      side,
      type: orderType,
      qty: Number(qtyInput),
      limitPrice: orderType === 'LIMIT' ? Number(limitPriceInput) : undefined,
    });

    if (!res.ok) {
      setFeedback({ type: 'err', msg: res.error ?? 'Order rejected.' });
      return;
    }

    setFeedback({
      type: 'ok',
      msg: `${side} ${qtyInput} ${activeTicker.symbol} ${orderType === 'MARKET' ? 'filled' : 'staged'}.`,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={`bg-[#171610] border border-white/[0.07] rounded-lg ${
        compact ? 'p-4' : 'p-5'
      } flex flex-col gap-3`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#F2F5F3]">Order Ticket</h2>
        <span className="font-mono text-[11px] text-[#87948D] tabular-nums">
          Mark {formatCurrency(activeTicker.price, activeTicker.price < 2 ? 3 : 2)} · BP{' '}
          {formatCurrency(buyingPower, 0)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 bg-[#11110d] p-1 rounded border border-[#2d2a1d]">
        <button
          type="button"
          onClick={() => {
            setSide('BUY');
            setFeedback(null);
          }}
          className={`h-9 rounded-sm font-mono text-xs font-semibold uppercase transition-colors ${
            side === 'BUY'
              ? 'bg-[var(--desk-accent)] text-[#070909]'
              : 'text-[#87948D] hover:text-[#F2F5F3]'
          }`}
        >
          Buy / Long
        </button>
        <button
          type="button"
          onClick={() => {
            setSide('SELL');
            setFeedback(null);
          }}
          className={`h-9 rounded-sm font-mono text-xs font-semibold uppercase transition-colors ${
            side === 'SELL'
              ? 'bg-[#FF5364] text-[#070909]'
              : 'text-[#87948D] hover:text-[#F2F5F3]'
          }`}
        >
          Sell / Short
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={`${formId}-symbol`}
            className="block font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-1"
          >
            Instrument
          </label>
          <select
            id={`${formId}-symbol`}
            value={activeTicker.symbol}
            onChange={(e) => {
              onSelectSymbol(e.target.value);
              setLimitDraft(undefined);
              setFeedback(null);
            }}
            className="w-full h-9 px-2.5 bg-[#11110d] border border-[#2d2a1d] focus:border-[color:var(--desk-accent)] focus:outline-none rounded text-[13px] font-mono text-[#F2F5F3]"
          >
            {tickers.map((t) => (
              <option key={t.symbol} value={t.symbol}>
                {t.symbol}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor={`${formId}-type`}
            className="block font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-1"
          >
            Execution Type
          </label>
          <select
            id={`${formId}-type`}
            value={orderType}
            onChange={(e) => {
              setOrderType(e.target.value as OrderType);
              setFeedback(null);
            }}
            className="w-full h-9 px-2.5 bg-[#11110d] border border-[#2d2a1d] focus:border-[color:var(--desk-accent)] focus:outline-none rounded text-[13px] font-mono text-[#F2F5F3]"
          >
            <option value="MARKET">MARKET</option>
            <option value="LIMIT">LIMIT</option>
          </select>
        </div>
      </div>

      <div className={orderType === 'LIMIT' ? 'grid grid-cols-2 gap-3' : ''}>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label
              htmlFor={`${formId}-qty`}
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]"
            >
              Quantity
            </label>
            <div className="flex items-center gap-1">
              {[0.25, 0.5, 1].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => applyPresetPct(pct)}
                  className="px-1.5 py-0.5 font-mono text-[10px] bg-[#11110d] border border-[#2d2a1d] hover:border-[color:var(--desk-accent-line)] text-[#87948D] hover:text-[#F2F5F3] rounded-sm"
                >
                  {pct * 100}%
                </button>
              ))}
            </div>
          </div>
          <input
            id={`${formId}-qty`}
            type="number"
            step="any"
            min="0"
            value={qtyInput}
            onChange={(e) => {
              setQtyInput(e.target.value);
              setFeedback(null);
            }}
            placeholder="0.00"
            className="w-full h-9 px-3 bg-[#11110d] border border-[#2d2a1d] focus:border-[color:var(--desk-accent)] focus:ring-1 focus:ring-[color:var(--desk-accent)] focus:outline-none rounded font-mono text-[13px] text-[#F2F5F3] tabular-nums"
          />
        </div>

        {orderType === 'LIMIT' && (
          <div>
            <label
              htmlFor={`${formId}-limit-price`}
              className="block font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-1"
            >
              Limit Price
            </label>
            <input
              id={`${formId}-limit-price`}
              type="number"
              step="any"
              min="0"
              value={limitPriceInput}
              onChange={(e) => {
                setLimitDraft({ symbol: activeTicker.symbol, value: e.target.value });
                setFeedback(null);
              }}
              placeholder={String(activeTicker.price)}
              className="w-full h-9 px-3 bg-[#11110d] border border-[#2d2a1d] focus:border-[color:var(--desk-accent)] focus:ring-1 focus:ring-[color:var(--desk-accent)] focus:outline-none rounded font-mono text-[13px] text-[#F2F5F3] tabular-nums"
            />
          </div>
        )}
      </div>

      <div className="bg-[#11110d] border border-[#2d2a1d] rounded px-3 py-2 flex items-center justify-between text-xs font-mono">
        <span className="text-[#87948D]">Est. Notional</span>
        <span className="text-[#F2F5F3] font-medium tabular-nums">
          {formatCurrency(estNotional)}
        </span>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'err' ? 'alert' : 'status'}
          className={`px-3 py-2 rounded border font-mono text-[11px] ${
            feedback.type === 'err'
              ? 'bg-[#FF5364]/10 border-[#FF5364]/40 text-[#FF5364]'
              : 'bg-[var(--desk-accent-soft)] border-[color:var(--desk-accent-line)] text-[color:var(--desk-accent)]'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      <button
        type="submit"
        className={`h-10 w-full rounded font-mono text-xs font-semibold uppercase tracking-wider transition-all ${
          side === 'BUY'
            ? 'bg-[var(--desk-accent)] hover:bg-[var(--desk-accent-hover)] text-[#070909] hover:shadow-[0_0_12px_var(--desk-accent-soft)]'
            : 'bg-[#FF5364] hover:bg-[#e14353] text-[#070909]'
        }`}
      >
        Submit {side} {activeTicker.symbol}
      </button>
    </form>
  );
};
