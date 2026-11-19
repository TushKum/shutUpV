import React, { useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import type { ApiEndpointConfig, DeskState } from '../types/command';

interface ApiBridgeScreenProps {
  config: ApiEndpointConfig;
  state: DeskState;
  onUpdateConfig: (next: ApiEndpointConfig) => void;
}

export const ApiBridgeScreen: React.FC<ApiBridgeScreenProps> = ({
  config,
  state,
  onUpdateConfig,
}) => {
  const [draft, setDraft] = useState<ApiEndpointConfig>(config);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<'portfolio' | 'orders' | 'positions'>('portfolio');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateConfig(draft);
    setTestResult('Backend adapter configuration saved to active desk session.');
  };

  const handleProbe = () => {
    setTestResult(
      draft.mode === 'DEMO_SEED'
        ? 'The demo adapter uses simulated desk data.'
        : `Configured portfolio target: ${draft.restBaseUrl}${draft.endpoints.portfolio}. No request was sent.`,
    );
  };

  const samplePayload =
    previewKey === 'portfolio'
      ? {
          cash: state.cash,
          initialCapital: state.initialCapital,
          realizedPnl: state.realizedPnl,
          positionsCount: state.positions.length,
        }
      : previewKey === 'orders'
        ? state.orders.slice(0, 2)
        : state.positions.slice(0, 2);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      <form
        onSubmit={handleSave}
        className="xl:col-span-7 bg-[#101715] border border-white/[0.07] rounded-lg p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#1B2420]">
          <div>
            <h2 className="text-base font-semibold text-[#F2F5F3]">
              Backend Integration Bridge
            </h2>
            <p className="text-xs text-[#87948D] mt-0.5">
              Preview REST and WebSocket connection settings. This desk uses sample data.
            </p>
          </div>
          <div className="flex items-center bg-[#0C1110] border border-[#1B2420] p-0.5 rounded">
            <button
              type="button"
              onClick={() => setDraft({ ...draft, mode: 'DEMO_SEED' })}
              className={`px-3 py-1.5 rounded-sm font-mono text-xs whitespace-nowrap ${
                draft.mode === 'DEMO_SEED'
                  ? 'bg-[#151D19] text-[#00E676] border border-[#285D46]'
                  : 'text-[#87948D] hover:text-[#F2F5F3]'
              }`}
            >
              Demo Seed
            </button>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, mode: 'LIVE_BACKEND' })}
              className={`px-3 py-1.5 rounded-sm font-mono text-xs whitespace-nowrap ${
                draft.mode === 'LIVE_BACKEND'
                  ? 'bg-[#151D19] text-[#00E676] border border-[#285D46]'
                  : 'text-[#87948D] hover:text-[#F2F5F3]'
              }`}
            >
              Backend Draft
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="rest-base-url"
              className="block font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-1.5"
            >
              REST API Base URL
            </label>
            <input
              id="rest-base-url"
              type="text"
              value={draft.restBaseUrl}
              onChange={(e) => setDraft({ ...draft, restBaseUrl: e.target.value })}
              className="w-full h-9 px-3 bg-[#0C1110] border border-[#1B2420] focus:border-[#00E676] focus:outline-none rounded font-mono text-xs text-[#F2F5F3]"
            />
          </div>

          <div>
            <label
              htmlFor="ws-stream-url"
              className="block font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-1.5"
            >
              WebSocket Tick Stream URL
            </label>
            <input
              id="ws-stream-url"
              type="text"
              value={draft.wsStreamUrl}
              onChange={(e) => setDraft({ ...draft, wsStreamUrl: e.target.value })}
              className="w-full h-9 px-3 bg-[#0C1110] border border-[#1B2420] focus:border-[#00E676] focus:outline-none rounded font-mono text-xs text-[#F2F5F3]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="auth-header"
              className="block font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-1.5"
            >
              Authorization Header
            </label>
            <input
              id="auth-header"
              type="text"
              value={draft.authHeader}
              onChange={(e) => setDraft({ ...draft, authHeader: e.target.value })}
              className="w-full h-9 px-3 bg-[#0C1110] border border-[#1B2420] focus:border-[#00E676] focus:outline-none rounded font-mono text-xs text-[#F2F5F3]"
            />
          </div>

          <div>
            <label
              htmlFor="poll-interval"
              className="block font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-1.5"
            >
              Snapshot Refresh (ms)
            </label>
            <input
              id="poll-interval"
              type="number"
              min="250"
              step="250"
              value={draft.pollIntervalMs}
              onChange={(e) =>
                setDraft({ ...draft, pollIntervalMs: Number(e.target.value) || 1500 })
              }
              className="w-full h-9 px-3 bg-[#0C1110] border border-[#1B2420] focus:border-[#00E676] focus:outline-none rounded font-mono text-xs text-[#F2F5F3] tabular-nums"
            />
          </div>
        </div>

        <div className="pt-2 border-t border-[#1B2420]">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-2">
            Route Contracts
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(Object.keys(draft.endpoints) as (keyof ApiEndpointConfig['endpoints'])[]).map(
              (key) => (
                <div key={key} className="flex items-center gap-2">
                  <label
                    htmlFor={`ep-${key}`}
                    className="w-20 font-mono text-[11px] text-[#87948D] uppercase"
                  >
                    {key}
                  </label>
                  <input
                    id={`ep-${key}`}
                    type="text"
                    value={draft.endpoints[key]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        endpoints: { ...draft.endpoints, [key]: e.target.value },
                      })
                    }
                    className="flex-1 h-8 px-2.5 bg-[#0C1110] border border-[#1B2420] focus:border-[#00E676] focus:outline-none rounded font-mono text-xs text-[#F2F5F3]"
                  />
                </div>
              ),
            )}
          </div>
        </div>

        {testResult && (
          <div
            role="status"
            className="px-3 py-2 rounded bg-[#00E676]/10 border border-[#285D46] font-mono text-xs text-[#75FF9E] flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{testResult}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleProbe}
            className="h-9 px-4 bg-[#0C1110] border border-[#1B2420] hover:border-[#285D46] rounded font-mono text-xs text-[#F2F5F3] flex items-center gap-2 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Preview Contract</span>
          </button>
          <button
            type="submit"
            className="h-9 px-5 bg-[#00E676] hover:bg-[#00B86B] text-[#070909] font-mono text-xs font-semibold uppercase tracking-wide rounded transition-all hover:shadow-[0_0_12px_rgba(0,230,118,0.3)] whitespace-nowrap"
          >
            Save Adapter Config
          </button>
        </div>
      </form>

      {/* JSON Payload Contract Inspector */}
      <section className="xl:col-span-5 bg-[#101715] border border-white/[0.07] rounded-lg p-5 flex flex-col">
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#1B2420] gap-2">
          <h2 className="text-sm font-semibold text-[#F2F5F3]">
            Expected JSON Schema
          </h2>
          <div className="flex items-center bg-[#0C1110] border border-[#1B2420] p-0.5 rounded">
            {(['portfolio', 'orders', 'positions'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPreviewKey(k)}
                className={`px-2.5 py-1 rounded-sm font-mono text-[11px] uppercase whitespace-nowrap ${
                  previewKey === k
                    ? 'bg-[#151D19] text-[#00E676] border border-[#285D46]'
                    : 'text-[#87948D] hover:text-[#F2F5F3]'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <pre className="mt-3 flex-1 bg-[#070909] border border-[#1B2420] rounded p-3 font-mono text-xs text-[#BACBB9] overflow-auto max-h-[420px] leading-relaxed">
          {JSON.stringify(samplePayload, null, 2)}
        </pre>
      </section>
    </div>
  );
};
