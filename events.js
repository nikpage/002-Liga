// Computes the next concrete date for recurring events described in the RAG
// context (currently DOBROklub: "každý druhý čtvrtek v měsíci") and checks
// whether that date falls on a Czech public holiday. The result is injected
// into the prompt so the model can state a real upcoming date instead of
// silently dropping recurrence rules through the past-events filter.

// --- date helpers (UTC date-only to avoid timezone drift) ---

function toUtcDate(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// nth (1-based) occurrence of a weekday (0=Sun..6=Sat) in a given month.
function nthWeekdayOfMonth(year, month /* 0-based */, weekday, n) {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const day = 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
  return new Date(Date.UTC(year, month, day));
}

// Easter Sunday (Anonymous Gregorian / Computus algorithm).
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const FIXED_HOLIDAYS = {
  '1-1': 'Nový rok / Den obnovy samostatného českého státu',
  '5-1': 'Svátek práce',
  '5-8': 'Den vítězství',
  '7-5': 'Den slovanských věrozvěstů Cyrila a Metoděje',
  '7-6': 'Den upálení mistra Jana Husa',
  '9-28': 'Den české státnosti',
  '10-28': 'Den vzniku samostatného československého státu',
  '11-17': 'Den boje za svobodu a demokracii',
  '12-24': 'Štědrý den',
  '12-25': '1. svátek vánoční',
  '12-26': '2. svátek vánoční',
};

// Returns the Czech public-holiday name for a date, or null.
function czHolidayName(date) {
  const fixed = FIXED_HOLIDAYS[`${date.getUTCMonth() + 1}-${date.getUTCDate()}`];
  if (fixed) return fixed;

  const easter = easterSunday(date.getUTCFullYear());
  const goodFriday = new Date(easter.getTime() - 2 * 86400000);
  const easterMonday = new Date(easter.getTime() + 1 * 86400000);
  if (date.getTime() === goodFriday.getTime()) return 'Velký pátek';
  if (date.getTime() === easterMonday.getTime()) return 'Velikonoční pondělí';
  return null;
}

// Finds the DOBROklub recurrence rule in the retrieved chunks and extracts the
// year it applies to. Returns { year, phone } or null if the rule isn't present.
function parseDobroklubRule(chunks) {
  for (const c of chunks || []) {
    const text = c && c.content ? c.content : '';
    const m = text.match(/DOBROkluby\s+se\s+v\s+roce\s+(\d{4})\s+budou\s+konat\s+každý\s+druhý\s+čtvrtek/i);
    if (m) {
      const phoneMatch = text.match(/tel\.?:?\s*([\d ]{9,})/i);
      const phone = phoneMatch ? phoneMatch[1].replace(/\s+/g, ' ').trim() : null;
      return { year: parseInt(m[1], 10), phone };
    }
  }
  return null;
}

const CZ_WEEKDAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];

function formatCz(date) {
  return `${CZ_WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}. ${date.getUTCMonth() + 1}. ${date.getUTCFullYear()}`;
}

// Next 2nd Thursday on/after `today`, but only within the rule's stated year
// (so we never assert a schedule the source doesn't cover). Returns Date or null.
function nextSecondThursday(today, ruleYear) {
  let probe = new Date(today.getTime());
  for (let i = 0; i < 13; i++) {
    const candidate = nthWeekdayOfMonth(probe.getUTCFullYear(), probe.getUTCMonth(), 4, 2);
    if (candidate.getTime() >= today.getTime() && candidate.getUTCFullYear() === ruleYear) {
      return candidate;
    }
    if (candidate.getUTCFullYear() > ruleYear) return null;
    probe = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 1));
  }
  return null;
}

// Builds a Czech-language authoritative note about the next DOBROklub for the
// prompt, or '' when no rule is in context / the rule's year has passed.
function buildEventsNote(chunks, now) {
  const rule = parseDobroklubRule(chunks);
  if (!rule) return '';

  const today = toUtcDate(now);
  const next = nextSecondThursday(today, rule.year);
  if (!next) return '';

  let note = `Nejbližší DOBROklub: ${formatCz(next)} (vypočteno z pravidla „každý druhý čtvrtek v měsíci“ platného pro rok ${rule.year}).`;

  const holiday = czHolidayName(next);
  if (holiday) {
    note += ` POZOR: tento den připadá na státní svátek (${holiday}), akce se proto nemusí konat`;
    note += rule.phone
      ? ` — doporuč uživateli ověřit termín telefonicky na čísle ${rule.phone}.`
      : ` — doporuč uživateli ověřit termín telefonicky na kontaktním čísle pro akce uvedeném v kontextu.`;
  }
  return note;
}

module.exports = { buildEventsNote, czHolidayName, parseDobroklubRule, nextSecondThursday };
