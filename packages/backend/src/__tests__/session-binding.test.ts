import { describe, it } from 'node:test';
import assert from 'node:assert';

import { ipsInSameSubnet, sessionFingerprintMatches } from '../routes/auth';

// Session binding pins each refresh token to the (IP-subnet, UA) it
// was minted with. A roving user on the same residential connection
// gets DHCP'd within their /24, so we match on subnet rather than
// exact IP. A stolen token replayed from a different network — even
// the same city, same ISP — almost always trips one of these.

describe('ipsInSameSubnet', () => {
  describe('IPv4 (/24)', () => {
    it('matches identical IPs', () => {
      assert.strictEqual(ipsInSameSubnet('203.0.113.5', '203.0.113.5'), true);
    });

    it('matches IPs that share the first three octets', () => {
      assert.strictEqual(ipsInSameSubnet('203.0.113.5', '203.0.113.250'), true);
    });

    it('rejects IPs that differ in the third octet', () => {
      assert.strictEqual(ipsInSameSubnet('203.0.113.5', '203.0.114.5'), false);
    });

    it('rejects IPs that differ in the first octet', () => {
      assert.strictEqual(ipsInSameSubnet('203.0.113.5', '10.0.113.5'), false);
    });

    it('rejects malformed IPv4', () => {
      assert.strictEqual(ipsInSameSubnet('203.0.113', '203.0.113.5'), false);
    });
  });

  describe('IPv6 (/64)', () => {
    it('matches identical IPv6', () => {
      assert.strictEqual(
        ipsInSameSubnet('2001:db8::1', '2001:db8::1'),
        true,
      );
    });

    it('matches IPv6 that share the first /64', () => {
      // 2001:db8:abcd:0001::/64
      assert.strictEqual(
        ipsInSameSubnet('2001:db8:abcd:0001:0000:0000:0000:0001',
                        '2001:db8:abcd:0001:ffff:ffff:ffff:ffff'),
        true,
      );
    });

    it('matches across :: compression vs expanded form (same /64)', () => {
      assert.strictEqual(
        ipsInSameSubnet('2001:db8:abcd:1::1', '2001:db8:abcd:1:0:0:0:2'),
        true,
      );
    });

    it('rejects different /64 prefixes', () => {
      assert.strictEqual(
        ipsInSameSubnet('2001:db8:abcd:0001::1', '2001:db8:abcd:0002::1'),
        false,
      );
    });
  });

  describe('cross-family / edge cases', () => {
    it('rejects empty inputs', () => {
      assert.strictEqual(ipsInSameSubnet('', '203.0.113.5'), false);
      assert.strictEqual(ipsInSameSubnet('203.0.113.5', ''), false);
      assert.strictEqual(ipsInSameSubnet('', ''), false);
    });

    it('rejects when one is IPv4 and the other is IPv6', () => {
      assert.strictEqual(ipsInSameSubnet('203.0.113.5', '2001:db8::1'), false);
    });
  });
});

describe('sessionFingerprintMatches', () => {
  type Req = { ip?: string; headers: Record<string, string | undefined> };
  const req = (ip: string, ua: string): Req => ({ ip, headers: { 'user-agent': ua } });

  it('fails open for legacy sessions (no fingerprint pinned)', () => {
    const ctx = {};
    assert.strictEqual(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessionFingerprintMatches(ctx, req('1.2.3.4', 'Chrome') as any),
      true,
    );
  });

  it('matches when both IP-subnet and UA match', () => {
    const ctx = { ip: '203.0.113.10', userAgent: 'Mozilla/5.0 (Chrome)' };
    assert.strictEqual(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessionFingerprintMatches(ctx, req('203.0.113.99', 'Mozilla/5.0 (Chrome)') as any),
      true,
    );
  });

  it('rejects on UA mismatch even when IP is identical', () => {
    const ctx = { ip: '203.0.113.10', userAgent: 'Mozilla/5.0 (Chrome)' };
    assert.strictEqual(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessionFingerprintMatches(ctx, req('203.0.113.10', 'curl/8.0') as any),
      false,
      'UA mismatch should reject — distinguishes a script from a browser',
    );
  });

  it('rejects on IP-subnet mismatch even when UA is identical', () => {
    const ctx = { ip: '203.0.113.10', userAgent: 'Mozilla/5.0 (Chrome)' };
    assert.strictEqual(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessionFingerprintMatches(ctx, req('198.51.100.10', 'Mozilla/5.0 (Chrome)') as any),
      false,
    );
  });

  it('accepts a different IP in the same /24 (DHCP rotation within a network)', () => {
    const ctx = { ip: '203.0.113.5', userAgent: 'Mozilla/5.0 (Chrome)' };
    assert.strictEqual(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessionFingerprintMatches(ctx, req('203.0.113.200', 'Mozilla/5.0 (Chrome)') as any),
      true,
    );
  });
});
