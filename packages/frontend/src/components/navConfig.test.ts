import { describe, it, expect } from 'vitest';
import {
  navSections,
  ROUTE_GROUPS,
  bottomNavItems,
  MOBILE_PRIMARY,
  GET_STARTED_ITEM,
} from './navConfig';

describe('navConfig', () => {
  it('every NavItem.to in navSections has a unique route', () => {
    const allTos = navSections.flatMap((s) => s.items.map((i) => i.to));
    const dupes = allTos.filter((t, i) => allTos.indexOf(t) !== i);
    expect(dupes).toEqual([]);
  });

  it('every subGroup.itemTos entry points at a real item in the same section', () => {
    for (const section of navSections) {
      if (!section.subGroups) continue;
      const tos = new Set(section.items.map((i) => i.to));
      for (const sg of section.subGroups) {
        for (const to of sg.itemTos) {
          expect(tos.has(to), `subGroup "${sg.label}" references missing route ${to}`).toBe(true);
        }
      }
    }
  });

  it('every ROUTE_GROUPS key is a real nav item (no obsolete aliases)', () => {
    // ROUTE_GROUPS is for items that need legacy-path aliasing
    // (e.g. /report → /reports). Items without aliases don't appear
    // here. What we DO want to catch is a stale entry pointing at a
    // route that was renamed or removed.
    const knownTos = new Set<string>([
      GET_STARTED_ITEM.to,
      ...navSections.flatMap((s) => s.items.map((i) => i.to)),
      ...bottomNavItems.map((i) => i.to),
    ]);
    for (const key of Object.keys(ROUTE_GROUPS)) {
      expect(knownTos.has(key), `ROUTE_GROUPS key ${key} no longer matches a nav item`).toBe(true);
    }
  });

  it('MOBILE_PRIMARY items all exist in the desktop navSections', () => {
    const desktopTos = new Set(navSections.flatMap((s) => s.items.map((i) => i.to)));
    for (const item of MOBILE_PRIMARY) {
      expect(desktopTos.has(item.to), `mobile primary ${item.to} not in desktop nav`).toBe(true);
    }
  });
});
