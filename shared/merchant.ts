/** Turn a raw bank description into a clean, human merchant name. */

const PREFIXES = [
  /^return:\s*/i,
  /^D\d{4}\s+/, // Citi store codes ("D0964 TRADER JOE S …")
  /^(pos|debit card|check ?card|checkcard|visa|dbt|purchase|recurring)\s+(purchase\s+)?(authorized\s+on\s+\d{1,2}\/\d{1,2}\s+)?/i,
  /^purchase authorized on \d{1,2}\/\d{1,2}\s+/i,
  /^(sq|tst|sp|pp|dd|py|ckb|in|par|fs|pos)\s?\*\s?/i,
  /^paypal\s?\*\s?/i,
  /^amzn\s+mktp\s+us\*?\w*/i,
];

const US_STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';

// Trailing city names that banks append (kept to her area; others stay, which is harmless).
const CITY_RE = /\s+(palo alto|stanford|redwood city|mountain view|menlo park|san jose|san francisco|cupertino|folsom|sunnyvale|santa clara|los altos|east palo alto)$/i;

const KNOWN: [RegExp, string][] = [
  [/amzn|amazon/i, 'Amazon'],
  [/wal-?mart/i, 'Walmart'],
  [/vzwrlss|verizon/i, 'Verizon'],
  [/apple\.com\/bill|itunes\.com/i, 'Apple'],
  [/coupa/i, 'Coupa Cafe'],
  [/thredup/i, 'ThredUp'],
  [/depop/i, 'Depop'],
  [/brandy melville/i, 'Brandy Melville'],
  [/stanford univ bkst|stanford bookstore/i, 'Stanford Bookstore'],
  [/uber\s*\*?\s*eats/i, 'Uber Eats'],
  [/uber/i, 'Uber'],
  [/lyft/i, 'Lyft'],
  [/doordash/i, 'DoorDash'],
  [/starbucks/i, 'Starbucks'],
  [/trader joe/i, "Trader Joe's"],
  [/spotify/i, 'Spotify'],
  [/netflix/i, 'Netflix'],
  [/target/i, 'Target'],
  [/safeway/i, 'Safeway'],
  [/whole ?foods|wfm/i, 'Whole Foods'],
  [/chipotle/i, 'Chipotle'],
  [/caltrain/i, 'Caltrain'],
];

export function cleanMerchant(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  for (const [re, name] of KNOWN) if (re.test(s)) return name;
  for (const re of PREFIXES) s = s.replace(re, '');
  s = s
    // Citi location codes glued to the city ("VIEWCAUS05154")
    .replace(/[A-Z]{2}US\d{5}\b/g, ' ')
    // card numbers, reference numbers, dates
    .replace(/\b(x{2,}|\*{2,})\d{2,}\b/gi, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
    .replace(/#\s?\d+/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // trailing "CITY ST" or just "ST"
    .replace(new RegExp(`\\s+(${US_STATES})$`, 'i'), '')
    .replace(/\s+\d+$/, '')
    .replace(CITY_RE, '')
    .replace(CITY_RE, '')
    .replace(/[*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return titleCase(raw.trim());
  return titleCase(s);
}

/** Key used to match merchants and rules ("Blue Bottle" and "BLUE BOTTLE" are the same). */
export function merchantKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function titleCase(s: string): string {
  // Leave mixed-case strings (already human) alone.
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/'S\b/g, "'s");
}
