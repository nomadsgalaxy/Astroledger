// Session tokens shared between the seed script and the specs.
export const SESSIONS = {
  owner: 'e2e-session-owner',
  partner: 'e2e-session-partner',
  helper: 'e2e-session-helper',
  advisor: 'e2e-session-advisor',
  // A user row with a session and NOTHING else — the exact state right after
  // a first OAuth sign-in, before any space/membership exists.
  newbie: 'e2e-session-newbie',
} as const;
