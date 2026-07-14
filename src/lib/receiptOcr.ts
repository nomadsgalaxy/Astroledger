// Receipt OCR via a vision-capable LLM (Ollama-style, OpenAI-style).
// Best-effort: returns null if no vision model is reachable. The caller
// should still save the file even if OCR fails.

import { llmConfig, llmAvailable } from './llm';

export type ReceiptOcr = {
  amount?: number;
  merchant?: string;
  date?: string;          // YYYY-MM-DD
  ocrText?: string;
  confidence: number;     // 0..1
};

const OCR_MODEL = process.env.LLM_VISION_MODEL || 'qwen2.5vl:7b';

const SYSTEM = `You read images of paper or digital receipts and return strict JSON with the merchant, total amount, and date. The total is the bottom-line "TOTAL" line on the receipt - not the subtotal and not any individual line item. Date is the receipt's printed date (use YYYY-MM-DD). If you can't tell, omit the field. Return ONLY JSON, no prose.`;

const USER = `Extract the receipt fields. Respond as strict JSON only:
{"merchant": "string", "amount": number, "date": "YYYY-MM-DD", "confidence": number_0_to_1}
If a field is unclear, omit it (do NOT guess). Confidence reflects overall legibility.`;

/**
 * Run OCR against a receipt image. Pass the buffer + mime type from a file
 * upload. PDFs are not yet supported (would need rasterization first).
 */
export async function ocrReceipt(buf: Buffer, mimeType: string): Promise<ReceiptOcr | null> {
  if (!mimeType.startsWith('image/')) return null;
  if (!(await llmAvailable())) return null;

  const { baseUrl, apiKey } = llmConfig();
  const b64 = buf.toString('base64');
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const body = {
    model: OCR_MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: USER },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
    stream: false,
  };

  try {
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content);
    return {
      merchant:   typeof parsed.merchant === 'string' ? parsed.merchant.trim() : undefined,
      amount:     typeof parsed.amount === 'number' ? parsed.amount : undefined,
      date:       typeof parsed.date === 'string' ? parsed.date : undefined,
      ocrText:    typeof parsed.text === 'string' ? parsed.text : undefined,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  } catch {
    return null;
  }
}
