import { redirect } from 'next/navigation';

// /foresight lands on the Forecast tab by default. The (foresight) route-group
// layout above renders the shared tab strip for all three views.
export default function ForesightLanding() {
  redirect('/forecast');
}
