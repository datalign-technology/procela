/**
 * Data Quality Rule Engine
 *
 * Evaluates a typed DQ rule against the values of a single column. Works in
 * two modes:
 *
 *  - Real: when the rule's Data Asset was imported from a FILE_STORAGE/LOCAL
 *    connection with a concrete `sourceColumn`, the engine reads the uploaded
 *    file and runs the rule against the actual values.
 *
 *  - Simulated: for every other connection type (DATABASE / DATA_WAREHOUSE /
 *    API / cloud FILE_STORAGE / SPREADSHEET) we don't have a driver, so the
 *    engine returns a clearly-labelled simulated result that is deterministic
 *    per (asset, rule) so repeated runs don't thrash.
 */

import { readColumnValues } from '../lib/local-file-connector';

export type RuleType =
  | 'NOT_NULL'
  | 'UNIQUE'
  | 'REGEX_MATCH'
  | 'IN_SET'
  | 'NUMERIC_RANGE'
  | 'LENGTH_RANGE';

export interface RuleParameters {
  pattern?: string;              // REGEX_MATCH
  allowedValues?: string[];      // IN_SET
  min?: number;                  // NUMERIC_RANGE
  max?: number;                  // NUMERIC_RANGE
  minLength?: number;            // LENGTH_RANGE
  maxLength?: number;            // LENGTH_RANGE
}

export interface RuleRunResult {
  ranAt: string;
  simulated: boolean;
  totalRows: number;
  passCount: number;
  failCount: number;
  passRate: number; // 0-100, integer
  failureSamples: string[];
  message: string;
}

export interface RuleSubject {
  // Information about the Data Asset's source, looked up by the caller.
  connectionType?: string;
  storageType?: string;
  localFilePath?: string;
  sourceColumn?: string;
  originalFileName?: string;
  // Fallback context for simulated evaluation.
  assetId: string;
  ruleId: string;
}

// ── Public API ────────────────────────────────────────────────────────────

export function evaluateRule(
  ruleType: RuleType,
  params: RuleParameters,
  subject: RuleSubject,
): RuleRunResult {
  const canExecuteForReal =
    subject.connectionType === 'FILE_STORAGE' &&
    subject.storageType === 'LOCAL' &&
    !!subject.localFilePath &&
    !!subject.sourceColumn;

  if (canExecuteForReal) {
    try {
      const values = readColumnValues(subject.localFilePath!, subject.sourceColumn!);
      return evaluateValues(ruleType, params, values);
    } catch (err) {
      return emptyFailure(err instanceof Error ? err.message : String(err), false);
    }
  }
  return simulate(ruleType, subject);
}

// ── Real evaluation ───────────────────────────────────────────────────────

function evaluateValues(
  ruleType: RuleType,
  params: RuleParameters,
  values: Array<string | null>,
): RuleRunResult {
  const total = values.length;
  const now = new Date().toISOString();

  switch (ruleType) {
    case 'NOT_NULL': {
      const failures: string[] = [];
      let fails = 0;
      for (const v of values) {
        if (v === null || v === '') fails++;
      }
      // NOT_NULL failures are by definition empty — report row positions.
      if (fails > 0) failures.push(`${fails} empty / missing value${fails === 1 ? '' : 's'}`);
      return finaliseResult(total, fails, failures, now,
        `${total - fails}/${total} rows have a value for this column`);
    }

    case 'UNIQUE': {
      const seen = new Map<string | null, number>();
      for (const v of values) {
        const key = v === null ? '__NULL__' : v;
        seen.set(key, (seen.get(key) || 0) + 1);
      }
      const duplicates = Array.from(seen.entries()).filter(([, count]) => count > 1);
      const failingRows = duplicates.reduce((s, [, c]) => s + c, 0);
      const samples = duplicates
        .slice(0, 5)
        .map(([v, c]) => `${String(v)} (×${c})`);
      return finaliseResult(total, failingRows, samples, now,
        duplicates.length === 0
          ? `All ${total} values are unique`
          : `${duplicates.length} duplicate value${duplicates.length === 1 ? '' : 's'} across ${failingRows} rows`);
    }

    case 'REGEX_MATCH': {
      if (!params.pattern) return emptyFailure('REGEX_MATCH requires a `pattern` parameter', false);
      let re: RegExp;
      try {
        re = new RegExp(params.pattern);
      } catch (err) {
        return emptyFailure(`Invalid regex: ${err instanceof Error ? err.message : String(err)}`, false);
      }
      const failures: string[] = [];
      let fails = 0;
      for (const v of values) {
        if (v === null || !re.test(v)) {
          fails++;
          if (failures.length < 5 && v !== null) failures.push(v);
        }
      }
      return finaliseResult(total, fails, failures, now,
        `${total - fails}/${total} rows match /${params.pattern}/`);
    }

    case 'IN_SET': {
      if (!params.allowedValues || params.allowedValues.length === 0) {
        return emptyFailure('IN_SET requires a non-empty `allowedValues` list', false);
      }
      const set = new Set(params.allowedValues);
      const failures: string[] = [];
      let fails = 0;
      for (const v of values) {
        if (v === null || !set.has(v)) {
          fails++;
          if (failures.length < 5 && v !== null && !failures.includes(v)) failures.push(v);
        }
      }
      return finaliseResult(total, fails, failures, now,
        `${total - fails}/${total} rows are in the allowed set`);
    }

    case 'NUMERIC_RANGE': {
      const min = params.min;
      const max = params.max;
      if (min === undefined && max === undefined) {
        return emptyFailure('NUMERIC_RANGE requires `min` and/or `max`', false);
      }
      const failures: string[] = [];
      let fails = 0;
      for (const v of values) {
        if (v === null) { fails++; continue; }
        const n = Number(v);
        if (Number.isNaN(n)) {
          fails++;
          if (failures.length < 5) failures.push(v);
          continue;
        }
        if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
          fails++;
          if (failures.length < 5) failures.push(v);
        }
      }
      const rangeLabel =
        min !== undefined && max !== undefined ? `${min}..${max}` :
        min !== undefined ? `>= ${min}` :
        `<= ${max}`;
      return finaliseResult(total, fails, failures, now,
        `${total - fails}/${total} rows fall within ${rangeLabel}`);
    }

    case 'LENGTH_RANGE': {
      const minL = params.minLength;
      const maxL = params.maxLength;
      if (minL === undefined && maxL === undefined) {
        return emptyFailure('LENGTH_RANGE requires `minLength` and/or `maxLength`', false);
      }
      const failures: string[] = [];
      let fails = 0;
      for (const v of values) {
        const len = v === null ? 0 : v.length;
        if ((minL !== undefined && len < minL) || (maxL !== undefined && len > maxL)) {
          fails++;
          if (failures.length < 5 && v !== null) failures.push(v);
        }
      }
      const rangeLabel =
        minL !== undefined && maxL !== undefined ? `${minL}..${maxL} chars` :
        minL !== undefined ? `>= ${minL} chars` :
        `<= ${maxL} chars`;
      return finaliseResult(total, fails, failures, now,
        `${total - fails}/${total} rows are ${rangeLabel}`);
    }
  }
}

function finaliseResult(
  total: number,
  fails: number,
  samples: string[],
  ranAt: string,
  message: string,
): RuleRunResult {
  const pass = total - fails;
  const passRate = total === 0 ? 100 : Math.round((pass * 100) / total);
  return {
    ranAt, simulated: false,
    totalRows: total,
    passCount: pass,
    failCount: fails,
    passRate,
    failureSamples: samples,
    message,
  };
}

function emptyFailure(message: string, simulated: boolean): RuleRunResult {
  return {
    ranAt: new Date().toISOString(),
    simulated,
    totalRows: 0,
    passCount: 0,
    failCount: 0,
    passRate: 0,
    failureSamples: [],
    message,
  };
}

// ── Simulated evaluation ─────────────────────────────────────────────────

// Deterministic hash so repeated runs of the same (rule, asset) return the
// same number — users shouldn't see numbers fluctuate on every click.
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function simulate(ruleType: RuleType, subject: RuleSubject): RuleRunResult {
  const seed = hashCode(`${subject.assetId}:${subject.ruleId}:${ruleType}`);
  const totalRows = 10_000 + (seed % 90_000);
  // Typed rules have different realistic pass-rate bands so outcomes feel
  // appropriate to what the rule is checking.
  const band = RULE_PASS_BANDS[ruleType];
  const passRate = band.min + (seed % (band.max - band.min + 1));
  const passCount = Math.round((totalRows * passRate) / 100);
  const failCount = totalRows - passCount;
  return {
    ranAt: new Date().toISOString(),
    simulated: true,
    totalRows,
    passCount,
    failCount,
    passRate,
    failureSamples: [],
    message: `Simulated result (no driver wired for this connection type). Upload the data as a local file to get real DQ numbers.`,
  };
}

const RULE_PASS_BANDS: Record<RuleType, { min: number; max: number }> = {
  NOT_NULL: { min: 92, max: 100 },
  UNIQUE: { min: 85, max: 100 },
  REGEX_MATCH: { min: 80, max: 99 },
  IN_SET: { min: 88, max: 100 },
  NUMERIC_RANGE: { min: 90, max: 100 },
  LENGTH_RANGE: { min: 90, max: 100 },
};

// ── Out-of-the-box rule templates ─────────────────────────────────────────

export interface RuleTemplate {
  id: string;           // stable id, e.g. 'not-null', 'regex-email'
  ruleType: RuleType;
  dimension: 'COMPLETENESS' | 'ACCURACY' | 'TIMELINESS' | 'CONSISTENCY' | 'UNIQUENESS' | 'VALIDITY';
  name: string;
  description: string;
  parameters: RuleParameters;
  // Heuristic: this template is *suggested* when the column name matches.
  // Undefined means "applicable to every column".
  columnNamePattern?: RegExp;
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'not-null',
    ruleType: 'NOT_NULL',
    dimension: 'COMPLETENESS',
    name: 'Not null',
    description: 'Fails if any value is empty or missing.',
    parameters: {},
  },
  {
    id: 'unique',
    ruleType: 'UNIQUE',
    dimension: 'UNIQUENESS',
    name: 'Unique values',
    description: 'Fails if any value appears more than once.',
    parameters: {},
    columnNamePattern: /(^|_)id$|_key$/i,
  },
  {
    id: 'regex-email',
    ruleType: 'REGEX_MATCH',
    dimension: 'VALIDITY',
    name: 'Valid email format',
    description: 'Fails if values don\u2019t match a reasonable email pattern.',
    parameters: { pattern: '^[\\w.+-]+@[\\w-]+\\.[\\w.-]+$' },
    columnNamePattern: /email/i,
  },
  {
    id: 'regex-phone',
    ruleType: 'REGEX_MATCH',
    dimension: 'VALIDITY',
    name: 'Valid phone format',
    description: 'Fails on values that don\u2019t look like a phone number (digits, spaces, dashes, parentheses, optional + prefix).',
    parameters: { pattern: '^\\+?[0-9 ()\\-]{7,}$' },
    columnNamePattern: /(phone|tel|mobile)/i,
  },
  {
    id: 'regex-iso-date',
    ruleType: 'REGEX_MATCH',
    dimension: 'VALIDITY',
    name: 'ISO-8601 date/time',
    description: 'Fails on values that don\u2019t match YYYY-MM-DD or a full ISO timestamp.',
    parameters: { pattern: '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+\\-]\\d{2}:\\d{2})?)?$' },
    columnNamePattern: /(date|_at$|time)/i,
  },
  {
    id: 'regex-url',
    ruleType: 'REGEX_MATCH',
    dimension: 'VALIDITY',
    name: 'Valid URL',
    description: 'Fails on values that aren\u2019t http(s) URLs.',
    parameters: { pattern: '^https?://[\\w.-]+(:\\d+)?(/[^\\s]*)?$' },
    columnNamePattern: /(url|website|link)/i,
  },
  {
    id: 'regex-zip-us',
    ruleType: 'REGEX_MATCH',
    dimension: 'VALIDITY',
    name: 'US ZIP code',
    description: 'Fails on values that aren\u2019t 5-digit or 5+4 US ZIP codes.',
    parameters: { pattern: '^\\d{5}(-\\d{4})?$' },
    columnNamePattern: /(zip|postal)/i,
  },
  {
    id: 'in-set-status',
    ruleType: 'IN_SET',
    dimension: 'CONSISTENCY',
    name: 'One of allowed values',
    description: 'Fails on values that aren\u2019t in a caller-supplied allowed list. Fill in values after adding.',
    parameters: { allowedValues: [] },
    columnNamePattern: /(status|state|type|category|tier|role)/i,
  },
  {
    id: 'numeric-range',
    ruleType: 'NUMERIC_RANGE',
    dimension: 'VALIDITY',
    name: 'Numeric range',
    description: 'Fails on non-numeric values or values outside the min/max you supply.',
    parameters: {},
    columnNamePattern: /(amount|price|qty|quantity|count|score|age|year)/i,
  },
  {
    id: 'length-range',
    ruleType: 'LENGTH_RANGE',
    dimension: 'VALIDITY',
    name: 'Length range',
    description: 'Fails on values whose character length is outside the min/max you supply.',
    parameters: {},
  },
];

/**
 * Return templates applicable to a column. Templates with a matching
 * `columnNamePattern` come first (sorted as "suggested"); generic ones
 * follow. The caller decides how to present them.
 */
export function suggestTemplates(columnName: string | undefined): {
  suggested: RuleTemplate[];
  generic: RuleTemplate[];
} {
  if (!columnName) {
    return { suggested: [], generic: RULE_TEMPLATES };
  }
  const suggested: RuleTemplate[] = [];
  const generic: RuleTemplate[] = [];
  for (const t of RULE_TEMPLATES) {
    if (t.columnNamePattern && t.columnNamePattern.test(columnName)) {
      suggested.push(t);
    } else if (!t.columnNamePattern) {
      generic.push(t);
    } else {
      generic.push(t);
    }
  }
  return { suggested, generic };
}
