export interface NavItem {
  label: string;
  route: string;
  section: string;
  hidden?: boolean;
}

/**
 * Every page the sidebar offers, written once. `/calibration` is a page that
 * was planned and never configured, so its link opens nothing.
 */
export const NAV_CATALOG: NavItem[] = [
  { label: 'Star map', route: '/star-map', section: 'Observe' },
  { label: 'Telescopes', route: '/telescopes', section: 'Observe' },
  { label: 'Calibration', route: '/calibration', section: 'Maintain' },
];

export const SECTIONS = [{ name: 'Observe' }, { name: 'Maintain' }] as const;

/** Addresses pinned to the foot of the sidebar, each a button that navigates. */
export const PINNED = ['/settings/profile'];
