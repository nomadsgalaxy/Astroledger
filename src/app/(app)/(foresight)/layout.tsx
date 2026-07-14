import { SectionHeader } from '../../_components/atoms';
import ForesightTabs from '../../_components/ForesightTabs';

// Shared chrome for the Foresight views. URLs are unchanged thanks to the
// (foresight) route group - the parentheses make this layout segment
// URL-invisible. The tab strip is a client island so the active state tracks
// the live pathname (server-side headers() got stale on client-side nav).
export default function ForesightLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <SectionHeader
        eyebrow="Looking ahead"
        title="Foresight"
        subtitle="Understand what's next, test alternatives, commit a plan, and check progress without leaving the planning workspace."
      />
      <ForesightTabs />
      <div>{children}</div>
    </div>
  );
}
