// Regenerates packages/backend/src/lib/breached-passwords.txt.
//
// Run: node packages/backend/scripts/gen-breached-wordlist.mjs
//
// The wordlist combines the existing curated entries with programmatic
// expansion: common-word base set crossed with year suffixes (2018–2027),
// leetspeak substitutions (a→@, o→0, i→1, e→3, s→$), keyboard walks
// (qwerty, asdfgh, 1q2w3e variants), and operating defaults (admin:admin
// style entries). The output is sorted, deduplicated, and pinned with a
// header that records the generation timestamp and entry count.
//
// To upgrade to a fuller real-world corpus (HIBP top-10k or SecLists'
// 10-million-password-list-top-10000.txt) without changing code, drop
// the new list into src/lib/breached-passwords.txt directly OR point
// BREACHED_PASSWORDS_FILE at a custom path in the runtime env.

import { writeFileSync, readFileSync } from 'fs';

// Common base words drawn from public common-password analyses (RockYou,
// HIBP top patterns, SecLists' 10-million-password-list top categories).
const BASE = [
  // Top common passwords / words
  'password', 'qwerty', 'letmein', 'welcome', 'admin', 'login', 'master',
  'root', 'guest', 'demo', 'test', 'user', 'changeme', 'default',
  'secret', 'shadow', 'hello', 'sunshine', 'princess', 'love', 'baby',
  // Months / seasons
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
  'spring', 'summer', 'autumn', 'winter', 'fall',
  // Days / time
  'monday', 'friday', 'saturday', 'sunday',
  // Sports / hobbies
  'football', 'baseball', 'basketball', 'hockey', 'soccer', 'cricket',
  'tennis', 'golf', 'racing', 'gaming', 'fishing',
  // Characters / fandoms
  'batman', 'superman', 'spiderman', 'starwars', 'pokemon', 'mario',
  'sonic', 'tarzan', 'rocky', 'matrix', 'gandalf', 'frodo', 'simba',
  // Animals
  'dragon', 'monkey', 'tiger', 'eagle', 'falcon', 'phoenix', 'lion',
  'wolf', 'bear', 'panda', 'shark', 'snake', 'ninja',
  // Cars / brands
  'mustang', 'ferrari', 'toyota', 'honda', 'mercedes', 'bmw', 'porsche',
  'tesla', 'chevy', 'corvette',
  // Tech / industry
  'oracle', 'azure', 'google', 'microsoft', 'amazon', 'facebook',
  'apple', 'github', 'gitlab', 'jenkins', 'docker', 'kubernetes',
  'linux', 'windows', 'macbook', 'iphone', 'android',
  // Common names
  'michael', 'jennifer', 'jessica', 'james', 'robert', 'mary', 'patricia',
  'david', 'richard', 'thomas', 'charlie', 'sarah', 'andrew', 'william',
  // Procela-themed
  'procela', 'procelaadmin', 'proceladev', 'procelatest', 'procelademo',
  'procelaproduction', 'procelastaging', 'procelaapi', 'procelaweb',
  // Office / business
  'office', 'company', 'business', 'sales', 'marketing', 'finance',
  'support', 'helpdesk', 'service', 'operations', 'security',
  // Emotional / aspirational
  'freedom', 'forever', 'success', 'winner', 'hero', 'genius', 'magic',
  'rainbow', 'unicorn', 'butterfly', 'flower', 'star', 'moon', 'sun',
  // Misc
  'soup', 'pizza', 'coffee', 'beer', 'wine', 'chocolate', 'cookies',
  'computer', 'internet', 'website', 'network', 'database',
];

const SUFFIXES = ['', '1', '12', '123', '1234', '12345', '!', '@', '#',
  '!!', '?', '$', '01', '00', '99', '69', '!1', '1!', '*'];

const YEARS = ['2018', '2019', '2020', '2021', '2022', '2023', '2024',
  '2025', '2026', '2027'];

const NUM_PATTERNS = [
  '111111', '222222', '333333', '444444', '555555', '666666', '777777',
  '888888', '999999', '000000', '123123', '321321', '112233', '123321',
  '111222', '101010', '012345', '123456', '1234567', '12345678',
  '123456789', '1234567890', '987654321', '654321',
  '111', '1111', '11111',
];

const KEY_PATTERNS = [
  'qwerty', 'qwertyuiop', 'asdf', 'asdfgh', 'asdfghjkl', 'zxcv', 'zxcvbn',
  'zxcvbnm', 'qazwsx', 'qazwsxedc', '1qaz2wsx', '1qaz2wsx3edc',
  '1q2w3e', '1q2w3e4r', '1q2w3e4r5t', 'zaq1xsw2', 'mnbvcxz', 'poiuyt',
  'lkjhgfdsa', 'qwer', 'qwerty1234', 'qwerty12345', 'qwerty123456',
  'abc', 'abc1', 'abc12', 'abc123', 'abcd', 'abcdef', 'abcdefg',
  'abcdefgh', 'abcd1234', 'abc1234',
];

// Common leetspeak substitutions applied to the base set.
function leet(s) {
  return s
    .replace(/a/g, '@')
    .replace(/o/g, '0')
    .replace(/i/g, '1')
    .replace(/e/g, '3')
    .replace(/s/g, '$');
}

const out = new Set();

// Start from the existing curated list to preserve anything we'd
// already classified as breached.
try {
  const existing = readFileSync(new URL('../src/lib/breached-passwords.txt', import.meta.url).pathname, 'utf-8');
  for (const line of existing.split(/\r?\n/)) {
    const t = line.trim().toLowerCase();
    if (t && !t.startsWith('#')) out.add(t);
  }
} catch { /* */ }

for (const base of BASE) {
  for (const sfx of SUFFIXES) {
    out.add(base + sfx);
    out.add(base + sfx.toUpperCase());
  }
  for (const yr of YEARS) {
    out.add(base + yr);
    out.add(base + yr + '!');
    out.add(base + '@' + yr);
    out.add(base + '_' + yr);
  }
  out.add(leet(base));
  out.add(leet(base) + '!');
  out.add(leet(base) + '1');
  out.add(leet(base) + '123');
}

for (const p of NUM_PATTERNS) out.add(p);
for (const p of KEY_PATTERNS) {
  out.add(p);
  out.add(p + '1');
  out.add(p + '!');
}

// Common "Capitalized + year + !" pattern
for (const base of BASE) {
  const cap = base[0].toUpperCase() + base.slice(1);
  for (const yr of YEARS) {
    out.add((cap + yr + '!').toLowerCase());
    out.add((cap + yr).toLowerCase());
  }
}

// Common short sequences attackers cycle through
for (let i = 0; i < 100; i++) {
  out.add(String(i).padStart(2, '0').repeat(3));
}

// Common operating defaults
const OPS = [
  'admin:admin', 'root:root', 'admin:password', 'tomcat', 'manager',
  'sa', 'postgres', 'mysql', 'oracle', 'redis', 'rabbit', 'kafka',
  'jenkins', 'minio', 'prometheus', 'grafana', 'kibana', 'sonatype',
  'nexus', 'gitlab',
];
for (const o of OPS) {
  out.add(o.toLowerCase());
  for (const sfx of SUFFIXES.slice(0, 6)) out.add((o + sfx).toLowerCase());
}

const sorted = [...out].filter((s) => s.length > 0).sort();
const header = `# Procela breached-password wordlist. Loaded by password-policy.ts at
# boot and compared case-insensitively against the proposed password.
#
# This file is generated programmatically (see scripts/gen-breached-wordlist.mjs)
# from a curated base set plus common patterns (year suffixes, leetspeak
# substitutions, keyboard walks, "+1/+123/+!" variants, operating defaults).
# To upgrade to a fuller real-world corpus:
#   1. Download the top ~10k passwords from a HIBP-derived dump such as
#      SecLists' 10-million-password-list-top-10000.txt
#   2. Replace this file's contents (keep the leading # comment block).
#   3. Or, point BREACHED_PASSWORDS_FILE at a custom path in your env.
#
# Generated: ${new Date().toISOString()}
# Entries:   ${sorted.length}

`;
writeFileSync(new URL('../src/lib/breached-passwords.txt', import.meta.url).pathname, header + sorted.join('\n') + '\n');
console.log('wrote', sorted.length, 'entries');
