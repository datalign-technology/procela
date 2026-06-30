/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useRoleDrawerStore } from '../stores/roleDrawerStore';
import RoleDetailDrawer from './RoleDetailDrawer';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;

// CDO is a DAMA governance role with three real requiredSkills in the
// reference catalog, which means the drawer will fire the
// recommend-for-role endpoint. Good fixture for the recommendation
// section's behaviour.
const ROLE = 'CDO';

function openDrawerFor(roleType: string) {
  useOrgContext.setState({ activeOrgId: 'o1', activeOrgName: 'Test', activeOrgType: 'company' });
  useRoleDrawerStore.setState({ roleType });
}

function renderDrawer() {
  return render(
    <MemoryRouter>
      <RoleDetailDrawer />
    </MemoryRouter>,
  );
}

// Default: assignments empty, skills empty, recs empty. Tests
// override the recommendations call to exercise the new section.
function defaultGetImpl(rec: unknown[] = []) {
  return (url: string) => {
    if (url.startsWith('/skills/recommend-for-role')) return Promise.resolve({ success: true, data: rec });
    if (url.startsWith('/skills?')) return Promise.resolve({ success: true, data: [] });
    if (url.startsWith('/dama-roles')) return Promise.resolve({ success: true, data: [] });
    return Promise.resolve({ success: true, data: [] });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  useRoleDrawerStore.setState({ roleType: null });
});

describe('RoleDetailDrawer — Best-matching people', () => {
  it('does not render the recommendations section when no people overlap', async () => {
    mockGet.mockImplementation(defaultGetImpl([]));
    openDrawerFor(ROLE);
    renderDrawer();

    // Wait for the load cycle to settle by waiting on a stable header
    // that always renders (the role's display label).
    await screen.findByText('Chief Data Officer');
    expect(screen.queryByText(/Best-matching people/)).toBeNull();
  });

  it('renders the recommendations section with the matched / required score chip', async () => {
    mockGet.mockImplementation(defaultGetImpl([
      { personId: 'p1', personName: 'Alice',  matched: 3, required: 3, ratio: 1 },
      { personId: 'p2', personName: 'Bob',    matched: 2, required: 3, ratio: 2 / 3 },
      { personId: 'p3', personName: 'Carol',  matched: 1, required: 3, ratio: 1 / 3 },
    ]));
    openDrawerFor(ROLE);
    renderDrawer();

    await screen.findByText('Best-matching people');
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Carol')).toBeTruthy();
    // Score chip format: "{matched} / {required} skills"
    expect(screen.getAllByText(/\d+ \/ 3 skills/).length).toBe(3);
  });

  it('queries /skills/recommend-for-role with the role-reference skill names', async () => {
    mockGet.mockImplementation(defaultGetImpl([]));
    openDrawerFor(ROLE);
    renderDrawer();

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    const recCall = mockGet.mock.calls.find((c) => String(c[0]).startsWith('/skills/recommend-for-role'));
    expect(recCall).toBeTruthy();
    const url = String(recCall![0]);
    expect(url).toContain('orgId=o1');
    // The skills query param should encode the role's required skill names.
    expect(url).toContain('Stakeholder%20Management');
    expect(url).toContain('Executive%20Reporting');
    expect(url).toContain('Compliance%20Monitoring');
  });
});
