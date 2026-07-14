// Normalize raw bank descriptions to a clean merchant name.
// Bank statements are noisy: "TST* JOE'S COFFEE #4421 NEW YORK NY", "SQ *FARMERS MKT", "PAYPAL *NETFLIX", etc.

const PREFIX_NOISE = /^(tst\*|sq \*|sp \*|sp\*|paypal \*|pp\*|pos |purchase |debit card purchase |checkcard |pmnt |pmt |recurring payment |recur payment |aplpay |applepay |gpay |google \*)/i;
const SUFFIX_NOISE = /(\s+#\d+|\s+xx+\d+|\s+\*+\d+|\s+\d{2}\/\d{2}|\s+ref#?\s*\d+|\s+auth#?\s*\d+|\s+id:\s*\d+)/gi;
const TRAILING_LOC = /\s+([a-z]{2})\s*$/i; // " NY", " CA"
const CITY_TRAIL = /\s+[A-Z][A-Z]+(\s+[A-Z][A-Z]+)*\s+[A-Z]{2}\s*$/; // " NEW YORK NY"
const MULTI_SPACE = /\s+/g;

const KNOWN_ALIASES: Array<[RegExp, string]> = [
  [/\bnetflix\b/i, 'Netflix'],
  [/\bspotify\b/i, 'Spotify'],
  [/\bhulu\b/i, 'Hulu'],
  [/\bdisney\s*\+?\b/i, 'Disney+'],
  [/\bapple\.com\/bill\b|\bapple\s+services\b|\bitunes\b/i, 'Apple Services'],
  [/\bgoogle\s*(\*|\s)\s*(youtube|youtu)/i, 'YouTube'],
  [/\byoutube\s*(premium|tv)\b|\byoutube\b/i, 'YouTube'],
  [/\bgoogle\s*(\*|\s)\s*google storage\b|\bgoogle one\b/i, 'Google One'],
  [/\bgoogle\s*\*?\s*workspace\b|\bgsuite\b/i, 'Google Workspace'],
  [/\bamazon\s*prime\b/i, 'Amazon Prime'],
  [/\bamzn(\s|\*).*mktp|\bamazon\.com\b|\bamazon mktpl\b/i, 'Amazon'],
  [/\bwhole\s*foods\b|\bwfm\b/i, 'Whole Foods'],
  [/\btrader\s*joe/i, "Trader Joe's"],
  [/\bcostco\b/i, 'Costco'],
  [/\btarget\b/i, 'Target'],
  [/\bwalmart\b/i, 'Walmart'],
  [/\bstarbucks\b/i, 'Starbucks'],
  [/\buber\s*eats\b/i, 'Uber Eats'],
  [/\buber\b/i, 'Uber'],
  [/\blyft\b/i, 'Lyft'],
  [/\bdoor\s*dash\b|\bdoordash\b/i, 'DoorDash'],
  [/\bgrubhub\b/i, 'Grubhub'],
  [/\binstacart\b/i, 'Instacart'],
  [/\bshell oil\b|\bshell\s+\d/i, 'Shell'],
  [/\bchevron\b/i, 'Chevron'],
  [/\bexxon\b/i, 'Exxon'],
  [/\bcomcast\b|\bxfinity\b/i, 'Xfinity'],
  [/\bverizon\b/i, 'Verizon'],
  [/\bt-?mobile\b/i, 'T-Mobile'],
  [/\bat&?t\b/i, 'AT&T'],
  [/\bpge\b|\bpg&e\b/i, 'PG&E'],
  [/\bconed\b|\bcon edison\b/i, 'ConEd'],
  [/\bventra\b|\bmta\b|\bbart\b/i, 'Transit'],
  [/\bairbnb\b/i, 'Airbnb'],
  [/\bvrbo\b/i, 'Vrbo'],
  [/\bunited\s+(airlines|air)\b/i, 'United Airlines'],
  [/\bdelta\s+air\b/i, 'Delta'],
  [/\bsouthwest\s+air\b/i, 'Southwest'],
  [/\bopenai\b|\bchatgpt\b/i, 'OpenAI'],
  [/\banthropic\b|\bclaude\b/i, 'Anthropic'],
  [/\bgithub\b/i, 'GitHub'],
  [/\bnotion\b/i, 'Notion'],
  [/\b1password\b/i, '1Password'],
  [/\bdropbox\b/i, 'Dropbox'],
  [/\badobe\b/i, 'Adobe'],
  [/\bvenmo\b/i, 'Venmo'],
  [/\bzelle\b/i, 'Zelle'],
  [/\bcash\s*app\b|\bsquare cash\b/i, 'Cash App'],
  [/\bpaypal\b/i, 'PayPal'],
  [/\bplanet fitness\b/i, 'Planet Fitness'],
  [/\bequinox\b/i, 'Equinox'],
  [/\bclasspass\b/i, 'ClassPass'],
  [/\bpeloton\b/i, 'Peloton'],
];

export function normalizeMerchant(raw: string): string {
  if (!raw) return 'Unknown';
  let s = raw.trim();

  // PayPal/Square pass-throughs: "PAYPAL *NETFLIX" → "NETFLIX"
  const passthrough = s.match(/^(?:paypal|pp|sq|sp|tst)\s*\*\s*(.+)$/i);
  if (passthrough) s = passthrough[1];

  for (const [re, name] of KNOWN_ALIASES) if (re.test(s)) return name;

  s = s.replace(PREFIX_NOISE, '');
  s = s.replace(SUFFIX_NOISE, '');
  s = s.replace(CITY_TRAIL, '');
  s = s.replace(TRAILING_LOC, '');
  s = s.replace(/[*#]+/g, ' ');
  s = s.replace(MULTI_SPACE, ' ').trim();

  // TitleCase if all-caps
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return s || 'Unknown';
}
