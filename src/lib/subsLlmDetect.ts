// LLM-assisted subscription detection. Given a parsed receipt + the list of
// known subscriptions, ask the local LLM to classify whether this receipt
// represents recurring spend and whether it matches an existing subscription
// or looks like a new one.
//
// Designed to complement (not replace) the rules-based detector in
// detectSubscriptions.ts. The rules engine finds patterns across many txs;
// this single-receipt classifier catches first-of-its-kind charges.

import { chat, llmAvailable } from './llm';
import { ensureLlmRunning } from './llmDocker';
import { prisma } from './prisma';

export type SubVerdict = {
  isRecurring: boolean;
  confidence: number;       // 0..1
  matchedSubscriptionId?: string;
  newSubscription?: {
    merchant: string;
    estimatedAmount: number;
    cadence: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual' | 'irregular';
    reasoning: string;
  };
};

const SYSTEM_PROMPT = `You classify e-commerce receipts for a personal-budget app.
Given a receipt (merchant, amount, items, source) and the list of existing tracked
subscriptions, return strict JSON with:
  - is_recurring: boolean - does this look like a recurring/subscription charge?
  - confidence: 0..1
  - matches_subscription_id: string|null - if it matches a known sub, the id
  - new_subscription: object|null - if recurring AND not matched, suggest:
      { merchant, estimated_amount, cadence: weekly|biweekly|monthly|quarterly|annual|irregular, reasoning }
Be conservative: a one-off Amazon purchase is NOT recurring. A monthly streaming
service IS. Restaurants, ride-shares, and grocery trips are NOT.`;

export async function classifyReceipt(receipt: {
  merchant: string;
  amount: number;
  source: string;
  items?: Array<{ name: string }>;
}): Promise<SubVerdict | null> {
  // Hard skip when LLM not reachable - we degrade gracefully.
  const status = await ensureLlmRunning();
  if (!status.ok || !(await llmAvailable())) return null;

  const subs = await prisma.subscription.findMany({
    where: { status: 'active' },
    select: { id: true, merchant: true, amount: true, cadence: true },
    take: 200,
  });

  const userMsg = JSON.stringify({
    receipt: {
      merchant: receipt.merchant,
      amount: receipt.amount,
      source: receipt.source,
      items: receipt.items?.slice(0, 5).map(i => i.name) ?? [],
    },
    existing_subscriptions: subs.map(s => ({
      id: s.id, merchant: s.merchant, amount: s.amount, cadence: s.cadence,
    })),
  });

  try {
    const res = await chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMsg },
      ],
      { temperature: 0.1, responseFormat: 'json_object' },
    );
    const parsed = JSON.parse(res.content);
    return {
      isRecurring: !!parsed.is_recurring,
      confidence: Number(parsed.confidence) || 0,
      matchedSubscriptionId: parsed.matches_subscription_id || undefined,
      newSubscription: parsed.new_subscription ? {
        merchant: parsed.new_subscription.merchant,
        estimatedAmount: Number(parsed.new_subscription.estimated_amount) || 0,
        cadence: parsed.new_subscription.cadence,
        reasoning: parsed.new_subscription.reasoning ?? '',
      } : undefined,
    };
  } catch {
    return null;
  }
}

const CADENCE_DAYS: Record<string, number> = {
  weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, annual: 365, irregular: 30,
};

// Apply a verdict: create a new Subscription row if the LLM found a confident
// new one, OR write a Recommendation row for the user to review/confirm.
export async function applyVerdict(verdict: SubVerdict, orderId: string) {
  if (!verdict.isRecurring || verdict.confidence < 0.6) return null;

  if (verdict.matchedSubscriptionId) {
    // Already known - surface a recommendation so user sees the link.
    await prisma.recommendation.create({
      data: {
        kind: 'new_recurring',
        title: `Matched recurring charge`,
        detail: `An order was matched to an existing subscription (id ${verdict.matchedSubscriptionId.slice(0, 8)}) by the LLM with confidence ${(verdict.confidence * 100).toFixed(0)}%.`,
        monthlySavings: 0,
        refType: 'subscription',
        refId: verdict.matchedSubscriptionId,
      },
    });
    return { kind: 'matched' as const, subscriptionId: verdict.matchedSubscriptionId };
  }

  if (verdict.newSubscription) {
    const ns = verdict.newSubscription;
    const cadenceDays = CADENCE_DAYS[ns.cadence] ?? 30;
    // Don't auto-create the Subscription row - that's the rules engine's job
    // once 2+ charges confirm it. Instead surface a recommendation so user can
    // accept/dismiss. This avoids LLM hallucination polluting the canonical
    // subscriptions table.
    await prisma.recommendation.create({
      data: {
        kind: 'new_recurring',
        title: `Possible new subscription: ${ns.merchant}`,
        detail: `LLM flagged this charge as a likely subscription (~${ns.estimatedAmount.toFixed(2)}/${ns.cadence}, ${(verdict.confidence * 100).toFixed(0)}% confidence). ${ns.reasoning}`,
        monthlySavings: ns.estimatedAmount * (30 / cadenceDays),
        refType: 'merchant',
        refId: orderId,
      },
    });
    return { kind: 'flagged' as const, merchant: ns.merchant };
  }

  return null;
}
