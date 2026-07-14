// Minimal Gmail API client + receipt scanner.
// Uses the access_token Auth.js stored for the user's Google account.
// Auto-refreshes via the refresh_token when expired.

import { prisma } from './prisma';

const G = 'https://gmail.googleapis.com/gmail/v1';

async function getValidAccessToken(userId: string): Promise<string> {
  const acct = await prisma.account.findFirst({ where: { userId, provider: 'google' } });
  if (!acct?.access_token) throw new Error('No Google account linked');
  const now = Math.floor(Date.now() / 1000);
  if (acct.expires_at && acct.expires_at > now + 30) return acct.access_token;
  if (!acct.refresh_token) throw new Error('No refresh token - sign out and back in with consent');

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    grant_type: 'refresh_token',
    refresh_token: acct.refresh_token,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const j = await res.json() as { access_token: string; expires_in: number; refresh_token?: string };
  await prisma.account.update({
    where: { id: acct.id },
    data: {
      access_token: j.access_token,
      expires_at: Math.floor(Date.now() / 1000) + j.expires_in,
      ...(j.refresh_token ? { refresh_token: j.refresh_token } : {}),
    },
  });
  return j.access_token;
}

async function gmailFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${G}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export type GmailMessage = {
  id: string; threadId: string; snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: Array<{ mimeType: string; body?: { data?: string; size?: number }; parts?: any }>;
    body?: { data?: string };
    mimeType?: string;
  };
  internalDate?: string;
};

function header(msg: GmailMessage, name: string): string | undefined {
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function decodeB64Url(s: string): string {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(norm, 'base64').toString('utf8');
}

// Walk MIME parts, collect text/plain + text/html bodies (decoded).
export function extractBodies(msg: GmailMessage): { text: string; html: string } {
  let text = '', html = '';
  const walk = (p: any) => {
    if (!p) return;
    if (p.body?.data) {
      const decoded = decodeB64Url(p.body.data);
      if (p.mimeType === 'text/plain') text += decoded + '\n';
      else if (p.mimeType === 'text/html') html += decoded + '\n';
    }
    if (p.parts) for (const sub of p.parts) walk(sub);
  };
  walk(msg.payload);
  return { text, html };
}

// Strip HTML tags crudely → text for parsing fallback.
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Find receipt-like messages in the user's inbox.
const RECEIPT_QUERY =
  'category:purchases OR subject:(receipt OR "order confirmation" OR "your order" OR "thanks for your order" OR "your receipt" OR "payment received" OR invoice)';

export async function listReceiptMessageIds(userId: string, opts: { sinceDays?: number; max?: number } = {}): Promise<string[]> {
  const token = await getValidAccessToken(userId);
  const sinceDays = opts.sinceDays ?? 90;
  const max = Math.min(opts.max ?? 250, 500);
  const q = encodeURIComponent(`${RECEIPT_QUERY} newer_than:${sinceDays}d`);
  let ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const path = `/users/me/messages?q=${q}&maxResults=${Math.min(100, max - ids.length)}` + (pageToken ? `&pageToken=${pageToken}` : '');
    const page = await gmailFetch<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(token, path);
    if (page.messages) ids.push(...page.messages.map(m => m.id));
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return ids;
}

export async function fetchMessage(userId: string, id: string): Promise<GmailMessage> {
  const token = await getValidAccessToken(userId);
  return gmailFetch<GmailMessage>(token, `/users/me/messages/${id}?format=full`);
}

export { header };
