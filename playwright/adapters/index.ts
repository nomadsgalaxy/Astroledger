import { adapter as amazon } from './amazon';
import type { Adapter } from './types';

// Register new adapters here. They appear in the UI at /connect automatically.
export const ADAPTERS: Record<string, Adapter> = {
  [amazon.id]: amazon,
};
