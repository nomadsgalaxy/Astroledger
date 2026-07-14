// Shared types for Playwright site adapters.
import type { Browser } from 'playwright';

export type AdapterCreds = { username: string; password: string; [extra: string]: string };

export type AdapterOrderDraft = {
  source: string;            // e.g. "playwright:amazon"
  externalId?: string;       // site-native order ID
  merchant: string;
  amount: number;            // positive dollar amount
  orderDate: string;         // ISO date
  items?: Array<{ name: string; qty?: number; price?: number }>;
  url?: string;
};

export type Adapter = {
  id: string;                // 'amazon', 'doordash', etc.
  label: string;
  description: string;
  run(opts: { browser: Browser; creds: AdapterCreds; sinceDays?: number }): Promise<AdapterOrderDraft[]>;
};
