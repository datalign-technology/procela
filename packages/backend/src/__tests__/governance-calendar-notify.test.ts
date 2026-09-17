// Adding a person to a governance calendar event's attendee list writes them
// an in-app notification — on create (every attendee is new) and on update
// (only the newly-added ids, never a duplicate for someone already invited).
// Email is transactional and only fires when SMTP is configured, so it's a
// no-op under test; these assertions cover the in-app path.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const calRouter = require('../routes/governance-calendar').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { calendarEvents } = require('../routes/governance-calendar');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { people } = require('../routes/people');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { notifications } = require('../routes/notifications');

const P = 'calnotify-';
const orgId = P + 'org';
const alice = P + 'alice';
const bob = P + 'bob';

function req(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(Buffer.byteLength(data)); }
    const r = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let c = ''; res.on('data', (d) => { c += d; });
      res.on('end', () => { try { resolve({ status: res.statusCode || 0, body: c ? JSON.parse(c) : null }); } catch { resolve({ status: res.statusCode || 0, body: c }); } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

const notifsFor = (personId: string) =>
  notifications.filter((n: any) => n.userId === personId && n.title === 'Added to a governance meeting');

describe('Calendar attendee notifications', () => {
  let server: http.Server; let port: number;

  before(async () => {
    // Seed two people with emails in our org.
    const now = new Date().toISOString();
    people.push(
      { id: alice, orgId, name: 'Alice', email: 'alice@example.com', role: 'VIEWER', department: '', createdAt: now, updatedAt: now },
      { id: bob, orgId, name: 'Bob', email: 'bob@example.com', role: 'VIEWER', department: '', createdAt: now, updatedAt: now },
    );
    const app = express(); app.use(express.json()); app.use('/', calRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    // Clean up only what this file seeded.
    for (const store of [people, calendarEvents, notifications]) {
      for (let i = store.length - 1; i >= 0; i--) {
        const row: any = store[i];
        if (row.orgId === orgId || row.userId === alice || row.userId === bob || row.id === alice || row.id === bob) store.splice(i, 1);
      }
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('notifies every attendee when an event is created', async () => {
    const res = await req(port, 'POST', '/', {
      orgId, name: 'Data Governance Council weekly', cadence: 'WEEKLY', attendees: [alice],
    });
    assert.equal(res.status, 201);
    assert.equal(notifsFor(alice).length, 1, 'Alice should be notified on create');
    const n = notifsFor(alice)[0];
    assert.match(n.message, /Data Governance Council weekly/);
    assert.equal(n.link, '/governance-calendar');
    assert.equal(notifsFor(bob).length, 0, 'Bob is not an attendee yet');
  });

  it('notifies only the newly-added attendee on update, not the existing one', async () => {
    const eventId = calendarEvents.find((e: any) => e.orgId === orgId)!.id;
    const res = await req(port, 'PUT', `/${eventId}`, { attendees: [alice, bob] });
    assert.equal(res.status, 200);
    assert.equal(notifsFor(bob).length, 1, 'Bob should be notified once he is added');
    assert.equal(notifsFor(alice).length, 1, 'Alice should NOT be re-notified — she was already an attendee');
  });

  it('does not notify when the attendee list is unchanged', async () => {
    const eventId = calendarEvents.find((e: any) => e.orgId === orgId)!.id;
    const res = await req(port, 'PUT', `/${eventId}`, { name: 'Renamed, same attendees', attendees: [alice, bob] });
    assert.equal(res.status, 200);
    assert.equal(notifsFor(alice).length, 1, 'Alice count unchanged');
    assert.equal(notifsFor(bob).length, 1, 'Bob count unchanged');
  });
});
