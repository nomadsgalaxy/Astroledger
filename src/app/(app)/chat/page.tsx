import { SectionHeader } from '../../_components/atoms';
import ChatPageClient from '../../_components/ChatPageClient';

export const dynamic = 'force-dynamic';

const SUGGESTIONS = [
  'How much did I spend on coffee last month?',
  'Which subscriptions are over $20/month?',
  'What was my biggest expense day this year?',
  'How much have I paid in loan interest this year?',
  'Summarize my Boise trip expenses.',
  'List transactions I forgot to tag.',
];

export default function ChatPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow="LLM + MCP"
        title="Ask Spacer"
        subtitle="Plain-English questions over your own transaction history. Spacer is not a licensed financial advisor and does not provide financial advice - it only reads the data you have already imported and answers questions about it, such as identifying merchants, summarizing where money went, and surfacing patterns. Treat every answer as a starting point, not a recommendation."
      />
      <ChatPageClient suggestions={SUGGESTIONS} />
    </div>
  );
}
