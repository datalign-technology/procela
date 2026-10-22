import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CertifiedBadge, { certStatusPill } from './CertifiedBadge';

const past = new Date(Date.now() - 86400_000).toISOString();
const future = new Date(Date.now() + 86400_000 * 30).toISOString();

describe('certStatusPill', () => {
  it('returns null for NONE / unset so the badge renders nothing', () => {
    expect(certStatusPill('NONE')).toBeNull();
    expect(certStatusPill(undefined)).toBeNull();
    expect(certStatusPill(null)).toBeNull();
  });

  it('labels a pending request', () => {
    expect(certStatusPill('PENDING_REVIEW')?.label).toBe('Certification pending');
  });

  it('labels a certified asset green when within its recert term', () => {
    const p = certStatusPill('CERTIFIED', future);
    expect(p?.label).toBe('Certified');
    expect(p?.color).toBe('#166534'); // green
  });

  it('flags an overdue certification as recert due (amber), not silently green', () => {
    const p = certStatusPill('CERTIFIED', past);
    expect(p?.label).toBe('Certified · recert due');
    expect(p?.color).toBe('#92400e'); // amber
  });

  it('treats a certified asset with no recert date as in-term', () => {
    expect(certStatusPill('CERTIFIED')?.label).toBe('Certified');
  });
});

describe('<CertifiedBadge>', () => {
  it('renders nothing for a non-certified asset', () => {
    const { container } = render(<CertifiedBadge status="NONE" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a label for a certified asset', () => {
    const { getByText } = render(<CertifiedBadge status="CERTIFIED" certifiedUntil={future} />);
    expect(getByText('Certified')).toBeTruthy();
  });

  it('shortens labels in compact mode', () => {
    const { getByText } = render(<CertifiedBadge compact status="CERTIFIED" certifiedUntil={past} />);
    expect(getByText('Recert due')).toBeTruthy();
  });
});
