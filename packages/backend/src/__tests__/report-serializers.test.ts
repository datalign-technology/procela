// Report serializers — the pure format converters that turn a rendered
// report (headers + rows) into a delivery artifact (CSV / Excel / PDF / an
// HTML table). Exercised without SMTP: each serializer is a pure function of
// its inputs.

import { describe, it } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  toCsv, toXlsx, toHtmlTable, toReportPdf, serializeReport, filenameBase, isReportFormat,
} = require('../services/report-serializers');

const HEADERS = ['Name', 'Tier', 'Health'];
const ROWS = [
  ['Customer Master', 'Silver', 92],
  ['Legacy "Billing"', 'Bronze', null],
];

describe('toCsv', () => {
  it('quotes every cell, doubles inner quotes, renders null empty, CRLF rows', () => {
    const csv = toCsv(HEADERS, ROWS);
    const lines = csv.split('\r\n');
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0], '"Name","Tier","Health"');
    assert.strictEqual(lines[1], '"Customer Master","Silver","92"');
    // Inner quotes doubled; null → empty string.
    assert.strictEqual(lines[2], '"Legacy ""Billing""","Bronze",""');
  });
});

describe('toHtmlTable', () => {
  it('renders a thead/tbody table and escapes cell content', () => {
    const html = toHtmlTable(HEADERS, ROWS);
    assert.match(html, /^<table/);
    assert.match(html, /<thead>.*Name.*Tier.*Health.*<\/thead>/s);
    // The quote in the second row is HTML-escaped.
    assert.match(html, /Legacy &quot;Billing&quot;/);
    // null renders as an empty cell, not "null".
    assert.doesNotMatch(html, />null</);
  });
});

describe('toXlsx', () => {
  it('returns a non-empty xlsx (zip) buffer', () => {
    const buf = toXlsx(HEADERS, ROWS, 'My Report');
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 0);
    // XLSX is a ZIP container — first two bytes are "PK".
    assert.strictEqual(buf.slice(0, 2).toString('latin1'), 'PK');
  });
});

describe('toReportPdf', () => {
  it('returns a PDF buffer (starts with %PDF)', async () => {
    const buf = await toReportPdf(HEADERS, ROWS, { reportName: 'My Report', orgName: 'Acme', totalMatched: 2 });
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 0);
    assert.strictEqual(buf.slice(0, 5).toString('latin1'), '%PDF-');
  });

  it('paginates a large row set without throwing', async () => {
    const many = Array.from({ length: 200 }, (_, i) => [`Asset ${i}`, 'Bronze', i]);
    const buf = await toReportPdf(HEADERS, many, { reportName: 'Big', orgName: 'Acme', totalMatched: 500 });
    assert.strictEqual(buf.slice(0, 5).toString('latin1'), '%PDF-');
  });
});

describe('serializeReport', () => {
  it('attaches a file for csv/xlsx/pdf and embeds html in the body', async () => {
    const meta = { reportName: 'Q3 Coverage', orgName: 'Acme', totalMatched: 2 };

    const csv = await serializeReport('csv', HEADERS, ROWS, meta);
    assert.strictEqual(csv.attachment?.filename, 'q3-coverage.csv');
    assert.strictEqual(csv.attachment?.contentType, 'text/csv; charset=utf-8');
    assert.strictEqual(csv.inlineHtml, undefined);

    const xlsx = await serializeReport('xlsx', HEADERS, ROWS, meta);
    assert.strictEqual(xlsx.attachment?.filename, 'q3-coverage.xlsx');
    assert.ok(Buffer.isBuffer(xlsx.attachment?.content));

    const pdf = await serializeReport('pdf', HEADERS, ROWS, meta);
    assert.strictEqual(pdf.attachment?.filename, 'q3-coverage.pdf');
    assert.strictEqual(pdf.attachment?.contentType, 'application/pdf');

    const html = await serializeReport('html', HEADERS, ROWS, meta);
    assert.strictEqual(html.attachment, undefined);
    assert.match(html.inlineHtml, /^<table/);
  });

  it('falls back to CSV for an unknown format', async () => {
    const out = await serializeReport('bogus', HEADERS, ROWS, { reportName: 'r', orgName: 'o', totalMatched: 0 });
    assert.strictEqual(out.attachment?.filename, 'r.csv');
  });
});

describe('helpers', () => {
  it('filenameBase slugifies', () => {
    assert.strictEqual(filenameBase('Q3 Coverage — Final!'), 'q3-coverage-final');
    assert.strictEqual(filenameBase(''), 'report');
  });
  it('isReportFormat guards the union', () => {
    assert.ok(isReportFormat('csv'));
    assert.ok(isReportFormat('html'));
    assert.ok(!isReportFormat('xml'));
    assert.ok(!isReportFormat(3));
  });
});
