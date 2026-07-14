import { NextRequest, NextResponse } from 'next/server';
import { importAmazonCsv, extractAmazonOrderCsvFromZip } from '@/lib/amazonImport';
import { matchOrders } from '@/lib/orderMatcher';

export const runtime = 'nodejs';

/**
 * Accepts either a raw `Order History.csv` (or legacy `Retail.OrderHistory.csv`)
 * OR the full `Your Orders.zip` Amazon ships. Zips are detected by magic bytes
 * (`PK`) so renamed files still work. Diagnostic info from the parser is
 * passed through to the UI so a `0 imported` outcome explains itself.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK"

    let csv: string;
    let extractedPath: string | null = null;
    if (isZip) {
      const out = await extractAmazonOrderCsvFromZip(buf);
      csv = out.csv;
      extractedPath = out.path;
    } else {
      csv = buf.toString('utf8');
    }

    const out = await importAmazonCsv(csv);
    const match = await matchOrders();
    return NextResponse.json({
      ...out,
      ...match,
      extractedFrom: extractedPath,
      uploadKind: isZip ? 'zip' : 'csv',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
