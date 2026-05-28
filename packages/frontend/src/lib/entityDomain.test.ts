import { describe, it, expect } from 'vitest';
import { processDomain, assetDomain } from './entityDomain';

describe('processDomain', () => {
  it('classifies a node with domain GOVERNANCE', () => {
    expect(processDomain({ domain: 'GOVERNANCE' })).toBe('GOVERNANCE');
  });
  it('defaults to OPERATIONAL for anything else', () => {
    expect(processDomain({ domain: 'OPERATIONAL' })).toBe('OPERATIONAL');
    expect(processDomain({ domain: null })).toBe('OPERATIONAL');
    expect(processDomain({})).toBe('OPERATIONAL');
  });
});

describe('assetDomain', () => {
  it('classifies GOVERNANCE_TEMPLATE-origin assets as governance', () => {
    expect(assetDomain({ origin: 'GOVERNANCE_TEMPLATE' })).toBe('GOVERNANCE');
  });
  it('treats every other origin as operational', () => {
    expect(assetDomain({ origin: 'MANUAL' })).toBe('OPERATIONAL');
    expect(assetDomain({ origin: null })).toBe('OPERATIONAL');
    expect(assetDomain({})).toBe('OPERATIONAL');
  });
});
