// Rule-based categorizer. Match merchant or raw description → category name.
// Categories must exist in DB (see prisma/seed.ts).

type Rule = { match: RegExp; category: string };

const RULES: Rule[] = [
  // Streaming
  { match: /\b(netflix|hulu|disney\+?|hbo|max|paramount|peacock|apple\s*tv|youtube(\s*premium|\s*tv)?)\b/i, category: 'Streaming' },
  { match: /\b(spotify|tidal|pandora|apple\s*music)\b/i, category: 'Streaming' },
  // SaaS
  { match: /\b(github|notion|1password|dropbox|adobe|figma|linear|slack|zoom|google\s*one|google\s*workspace|gsuite|openai|anthropic|claude)\b/i, category: 'SaaS' },
  // Groceries
  { match: /\b(whole\s*foods|trader\s*joe|safeway|kroger|publix|wegmans|aldi|sprouts|h\-?e\-?b|costco|sam'?s\s*club|food\s*lion|albertsons)\b/i, category: 'Groceries' },
  // Restaurants & coffee
  { match: /\b(starbucks|peet'?s|blue\s*bottle|dunkin|philz)\b/i, category: 'Coffee' },
  { match: /\b(uber\s*eats|doordash|grubhub|seamless|caviar|postmates|instacart)\b/i, category: 'Restaurants' },
  { match: /\b(mcdonald|chipotle|sweetgreen|panera|shake\s*shack|pizza|burger|grill|sushi|cafe|bistro|kitchen|tacos?|ramen|thai|noodle)\b/i, category: 'Restaurants' },
  // Transport
  { match: /\b(uber|lyft|taxi|cab)\b/i, category: 'Rideshare' },
  { match: /\b(shell|chevron|exxon|mobil|bp|76\s*gas|arco|valero|sunoco)\b/i, category: 'Gas' },
  { match: /\b(mta|bart|caltrain|transit|ventra|clipper|metro)\b/i, category: 'Transport' },
  // Travel
  { match: /\b(airbnb|vrbo|hotel|marriott|hilton|hyatt|airlines?|delta|united|southwest|jetblue|american\s*air|expedia|booking\.com)\b/i, category: 'Travel' },
  // Utilities
  { match: /\b(comcast|xfinity|spectrum|cox|fios)\b/i, category: 'Internet' },
  { match: /\b(verizon|t-?mobile|at&?t|sprint|mint\s*mobile)\b/i, category: 'Phone' },
  { match: /\b(pge|pg&e|coned|con\s*edison|water|gas\s*co|electric)\b/i, category: 'Utilities' },
  // Health & fitness
  { match: /\b(planet\s*fitness|equinox|classpass|peloton|orange\s*theory|barry'?s|soul\s*cycle|gym)\b/i, category: 'Fitness' },
  { match: /\b(cvs|walgreens|pharmacy|hospital|dental|optometr|kaiser|aetna|cigna|blue\s*cross|one\s*medical)\b/i, category: 'Health' },
  // Shopping
  { match: /\b(amazon|target|walmart|best\s*buy|ikea|home\s*depot|lowe'?s|etsy|ebay|shein|zara|h&m|uniqlo)\b/i, category: 'Shopping' },
  // Income
  { match: /\b(payroll|direct\s*dep|salary|ach\s*credit\s*payroll)\b/i, category: 'Income' },
  // Transfers
  { match: /\b(transfer|xfer|venmo|zelle|cash\s*app|paypal|wire)\b/i, category: 'Transfers' },
  // Fees
  { match: /\b(fee|service\s*charge|overdraft|nsf|atm\s*fee|interest\s*charged)\b/i, category: 'Fees' },
  // Cash
  { match: /\b(atm|cash\s*withdraw)\b/i, category: 'Cash' },
];

export function categorize(merchant: string, rawDescription?: string, amount?: number): string {
  const hay = `${merchant} ${rawDescription ?? ''}`;
  for (const r of RULES) if (r.match.test(hay)) return r.category;
  // Income heuristic by sign
  if (amount && amount > 0 && /credit|deposit|refund/i.test(hay)) return 'Income';
  return 'Other';
}
