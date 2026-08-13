/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import SkillGapsWidget, { type SkillGapRow } from './SkillGapsWidget';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;

function withOrg() {
  useOrgContext.setState({ activeOrgId: 'o1', activeOrgName: 'Test Org', activeOrgType: 'company' });
}
function withoutOrg() {
  useOrgContext.setState({ activeOrgId: '', activeOrgName: '', activeOrgType: '' });
}

function row(overrides: Partial<SkillGapRow> = {}): SkillGapRow {
  return {
    skillId: 's',
    skillName: 'Skill',
    category: 'GOVERNANCE',
    requiredByActivities: 1,
    heldByPeople: 1,
    gapScore: 1,
    ...overrides,
  };
}

function renderWidget() {
  return render(
    <MemoryRouter>
      <SkillGapsWidget />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  withOrg();
});

describe('SkillGapsWidget', () => {
  it('renders nothing when there is no active org', () => {
    withoutOrg();
    const { container } = renderWidget();
    expect(container).toBeEmptyDOMElement();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('renders an empty state (not nothing) when the API returns no rows', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    renderWidget();
    // The section still shows — an enabled dashboard widget should not
    // silently disappear — with an empty-state message and a link to skills.
    expect(await screen.findByText('Skill Gaps')).toBeTruthy();
    expect(screen.getByText(/No skill gaps to show yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Manage skills/ })).toBeTruthy();
  });

  it('hides rows where requiredByActivities is zero (held-but-unrequired)', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [
        row({ skillId: 's1', skillName: 'Required',  requiredByActivities: 3, heldByPeople: 1, gapScore: 3 }),
        row({ skillId: 's2', skillName: 'Unrequired', requiredByActivities: 0, heldByPeople: 5, gapScore: 0 }),
      ],
    });
    renderWidget();
    expect(await screen.findByText('Required')).toBeTruthy();
    expect(screen.queryByText('Unrequired')).toBeNull();
  });

  it('flags "no coverage" when zero people hold a required skill', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [row({ skillId: 's1', skillName: 'Critical', requiredByActivities: 4, heldByPeople: 0, gapScore: 4 })],
    });
    renderWidget();
    expect(await screen.findByText(/4 required · 0 held · no coverage/)).toBeTruthy();
  });

  it('caps the list at 5 rows', async () => {
    const many: SkillGapRow[] = Array.from({ length: 8 }, (_, i) => row({
      skillId: `s${i}`,
      skillName: `Skill ${i}`,
      requiredByActivities: 8 - i,
      heldByPeople: 1,
      gapScore: 8 - i,
    }));
    mockGet.mockResolvedValueOnce({ success: true, data: many });
    renderWidget();
    // First five should render…
    await screen.findByText('Skill 0');
    expect(screen.getByText('Skill 4')).toBeTruthy();
    // …sixth should not.
    expect(screen.queryByText('Skill 5')).toBeNull();
  });

  it('queries the gap-report endpoint scoped to the active org', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    renderWidget();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/skills/gap-report?orgId=o1'));
  });
});
