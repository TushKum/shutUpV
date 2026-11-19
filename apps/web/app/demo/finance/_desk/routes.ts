import type { ScreenId } from './types/command';

export const FINANCE_ROUTES = {
  overview: '/demo/finance',
  markets: '/demo/finance/markets',
  arena: '/demo/finance/pitch-arena',
  risk: '/demo/finance/risk',
} as const satisfies Record<ScreenId, string>;
