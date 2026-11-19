import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import FinanceDesk from './_desk/App';
import './finance.css';

export const metadata: Metadata = {
  title: { default: 'Finance Desk | PRIMUS Preview', template: '%s | PRIMUS Finance Preview' },
  description: 'Explore the PRIMUS finance desk with simulated prices and paper orders.',
};

export default function FinanceLayout({ children }: { children: ReactNode }) {
  return <FinanceDesk>{children}</FinanceDesk>;
}
