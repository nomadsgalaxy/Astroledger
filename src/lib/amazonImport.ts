// Import Amazon "Your Orders" CSV (Order History format).
//
// Amazon's "Request my data" export schema changes every few years. The current
// shape (as of 2026) ships inside `Your Orders.zip` at
// `Your Amazon Orders/Order History.csv` with one row per shipment. Columns:
//   Order ID · Order Date · Product Name · Original Quantity · Order Status
//   Total Amount · Shipment Item Subtotal · Unit Price · ...
//
// Older exports we still try to handle:
//   - Legacy `Order History Reports` Items CSV: Title, Quantity, Item Total (USD), Order Total (USD)
//   - "Retail.OrderHistory" Items CSV
//
// Rows with Order Status = "Cancelled" are skipped so we don't import phantom
// charges. We pick `Total Amount` (current) ahead of `Order Total (USD)`
// (legacy) ahead of summing item subtotals (fallback).
//
// See bug report 2026-05-22: previous parser only knew the legacy column names
// and silently imported 0 orders from a current-format export.

import Papa from 'papaparse';
import { prisma } from './prisma';

type Row = Record<string, string>;
function pick(r: Row, ...names: string[]): string | undefined {
  const keys = Object.keys(r);
  for (const n of names) {
    const k = keys.find(k => k.trim().toLowerCase() === n.toLowerCase());
    if (k && r[k]) return r[k];
  }
}

function parseMoney(s?: string): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : Math.abs(n);
}
function parseDate(s?: string): Date | null {
  if (!s) return null;
  const t = new Date(s);
  return isNaN(+t) ? null : t;
}

export type ImportResult = {
  created: number;
  itemsAdded: number;
  skipped: number;
  // Diagnostic counters surfaced to the UI so a "0 imported" outcome is
  // explained instead of silent. Sum should match parsed.data.length.
  skippedReasons: {
    noOrderId: number;
    noDate: number;
    noTotal: number;
    cancelled: number;
    duplicate: number;
  };
  // Column names actually present in the CSV header. Helps the user see
  // whether they uploaded the right file.
  headerSample: string[];
  rowCount: number;
};

export async function importAmazonCsv(csvText: string): Promise<ImportResult> {
  const parsed = Papa.parse<Row>(csvText, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
  const headerSample = (parsed.meta?.fields ?? []).slice(0, 12);

  const skippedReasons = { noOrderId: 0, noDate: 0, noTotal: 0, cancelled: 0, duplicate: 0 };

  // Group rows by Order ID - Amazon CSVs list one row per shipment/item.
  const grouped = new Map<string, {
    date: Date | null;
    total: number | null;
    subtotalSum: number;       // fallback when no top-level total column
    cancelled: boolean;
    items: Array<{ name: string; qty: number; price: number }>;
  }>();

  for (const r of parsed.data) {
    const orderId = pick(r, 'Order ID', 'OrderID');
    if (!orderId) { skippedReasons.noOrderId++; continue; }

    const date = parseDate(pick(r, 'Order Date', 'OrderDate'));
    // Current schema: "Total Amount". Legacy: "Order Total (USD)" / "Total Charged".
    const orderTotal = parseMoney(pick(r, 'Total Amount', 'Order Total (USD)', 'Total Charged'));
    // Per-shipment subtotal (fallback when Total Amount is missing).
    const shipmentSubtotal = parseMoney(pick(r, 'Shipment Item Subtotal', 'Item Total (USD)', 'Item Total'));
    // Per-item price (last-resort for item display when subtotal absent).
    const unitPrice = parseMoney(pick(r, 'Unit Price', 'Purchase Price Per Unit'));
    // Current schema: "Product Name". Legacy: "Title".
    const title = pick(r, 'Product Name', 'Title') ?? '';
    const qty = parseInt(pick(r, 'Original Quantity', 'Quantity', 'Qty') ?? '1') || 1;
    const status = (pick(r, 'Order Status') ?? '').toLowerCase();

    if (!grouped.has(orderId)) {
      grouped.set(orderId, { date, total: orderTotal, subtotalSum: 0, cancelled: false, items: [] });
    }
    const g = grouped.get(orderId)!;
    if (date && !g.date) g.date = date;
    if (orderTotal != null && (g.total == null || g.total < orderTotal)) g.total = orderTotal;
    // Cancelled rows sometimes have non-zero totals from authorization holds;
    // mark the whole order cancelled if any shipment row says so.
    if (status === 'cancelled' || status === 'canceled') g.cancelled = true;
    const itemPrice = shipmentSubtotal ?? (unitPrice != null ? unitPrice * qty : 0);
    if (shipmentSubtotal != null) g.subtotalSum += shipmentSubtotal;
    if (title) g.items.push({ name: title, qty, price: itemPrice });
  }

  let created = 0, itemsAdded = 0, skipped = 0;
  for (const [orderId, g] of grouped) {
    if (g.cancelled) { skippedReasons.cancelled++; skipped++; continue; }
    if (!g.date) { skippedReasons.noDate++; skipped++; continue; }
    // Use top-level total if Amazon provided one, else fall back to the sum
    // of shipment subtotals.
    const finalTotal = g.total ?? (g.subtotalSum > 0 ? g.subtotalSum : null);
    if (finalTotal == null) { skippedReasons.noTotal++; skipped++; continue; }
    try {
      await prisma.order.create({
        data: {
          source: 'amazon_csv',
          externalId: orderId,
          merchant: 'Amazon',
          orderDate: g.date,
          amount: finalTotal,
          items: JSON.stringify(g.items),
          url: `https://www.amazon.com/gp/your-account/order-details?orderID=${orderId}`,
        },
      });
      created++;
      itemsAdded += g.items.length;
    } catch {
      // Most likely a unique-constraint violation on (source, externalId).
      skippedReasons.duplicate++;
      skipped++;
    }
  }
  return { created, itemsAdded, skipped, skippedReasons, headerSample, rowCount: parsed.data.length };
}

/**
 * Pull the first matching CSV out of a `Your Orders.zip` buffer. Looks for
 * (in priority order):
 *   1. Anything ending in `Order History.csv` (current schema)
 *   2. Anything matching `Retail.OrderHistory*.csv` (older schema)
 *   3. The legacy `OrdersReturnsRefunds*.csv`
 * Returns the CSV text + the matched path. Throws if none found, with the
 * list of CSVs seen so the UI can show the user what was in their zip.
 */
export async function extractAmazonOrderCsvFromZip(buf: Buffer): Promise<{ csv: string; path: string; allCsvs: string[] }> {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(buf);
  const entries = zip.getEntries().filter(e => !e.isDirectory);
  const csvEntries = entries.filter(e => e.entryName.toLowerCase().endsWith('.csv'));
  const allCsvs = csvEntries.map(e => e.entryName);

  const candidates: Array<RegExp> = [
    /(^|\/)order history\.csv$/i,
    /(^|\/)retail\.orderhistory[^/]*\.csv$/i,
    /(^|\/)ordersreturnsrefunds[^/]*\.csv$/i,
  ];
  for (const pattern of candidates) {
    const hit = csvEntries.find(e => pattern.test(e.entryName));
    if (hit) {
      return { csv: hit.getData().toString('utf8'), path: hit.entryName, allCsvs };
    }
  }
  throw new Error(
    `No Order History CSV found inside the zip. Looked for "Your Amazon Orders/Order History.csv" ` +
    `(current Amazon export format) and "Retail.OrderHistory*.csv" (legacy). ` +
    `CSVs seen: ${allCsvs.join(', ') || '(none)'}`,
  );
}
