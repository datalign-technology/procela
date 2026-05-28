import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OwnerBadge, isInheritedAsset } from './OwnerBadge';

const getName = (id: string | null | undefined) => (id ? `Org ${id}` : '');

describe('isInheritedAsset', () => {
  it('is false when the asset is owned by the active org', () => {
    expect(isInheritedAsset('org-1', 'org-1')).toBe(false);
  });
  it('is true when the asset is owned by a different org', () => {
    expect(isInheritedAsset('org-2', 'org-1')).toBe(true);
  });
  it('is false when either id is missing', () => {
    expect(isInheritedAsset(undefined, 'org-1')).toBe(false);
    expect(isInheritedAsset('org-2', '')).toBe(false);
  });
});

describe('OwnerBadge', () => {
  it('renders nothing when the asset is owned by the active org', () => {
    const { container } = render(
      <OwnerBadge assetOrgId="org-1" activeOrgId="org-1" getOrgName={getName} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders "Owned by <name>" when inherited from another org', () => {
    render(<OwnerBadge assetOrgId="org-2" activeOrgId="org-1" getOrgName={getName} />);
    expect(screen.getByText('Owned by Org org-2')).toBeInTheDocument();
  });

  it('renders nothing when the owner name cannot be resolved', () => {
    const { container } = render(
      <OwnerBadge assetOrgId="org-2" activeOrgId="org-1" getOrgName={() => ''} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
