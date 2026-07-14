import { redirect } from 'next/navigation';

// Kept for old bookmarks. Recommendations, spending caps, dismissed items,
// and upcoming charges now live together in the single Insights workspace.
export default function InsightsRedirect() {
  redirect('/alerts');
}
