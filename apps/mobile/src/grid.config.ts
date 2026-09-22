import { PRODUCT_MARKS, type GridApp } from '@/grid';

import { apiUrl, isTeam } from '@/config';

// Mahaam on the grid. The mark is the one drawn for it on the product-marks sheet (under its old
// name, Managy); on a dark ground the body lifts to the lighter purple the web uses there.
//
// The primary action is the brand purple rather than the grid's default orange. Labels on it clear
// 4.5:1 with the two permitted text colours:
//   #8C3FB5 + ivory #F0EBE1  5.2:1  — light ground
//   #B784D6 + ink   #0E1A3C  5.8:1  — dark ground
export const APP: GridApp = {
  key: 'mahaam',
  name: isTeam ? 'Mahaam Team' : 'Mahaam Client',
  mark: { ...PRODUCT_MARKS.managy!, name: 'Mahaam', bodyOnDark: '#B784D6' },
  action: { light: '#8C3FB5', dark: '#B784D6' },
  onAction: { light: '#F0EBE1', dark: '#0E1A3C' },
  // Mahaam's own client (src/api) talks to the API; the grid's api/session layer is not mounted.
  apiOrigin: apiUrl,
  siteOrigin: process.env.EXPO_PUBLIC_SITE_ORIGIN || 'https://mahaam.app',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'info@3x1.io',
};
