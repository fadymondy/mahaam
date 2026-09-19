// Colours from the web design tokens (web/app/styles/grid-tokens.css + mahaam-brand.css).
// Contrast (WCAG): Paper on Brand 5.06:1; Ink-card on the dark brand #B784D6 5.91:1.
export const palettes = {
  light: {
    bg: "#F0EBE1",
    card: "#F7F4EC",
    elevated: "#FAF8F3",
    line: "#DED5C4",
    soft: "#EDE7DB",
    fg: "#0E1A3C",
    body: "#4A4438",
    muted: "#6E6551",
    brand: "#8C3FB5",
    onBrand: "#F0EBE1",
    accent: "#C9A227",
    accentText: "#7D6310",
    ok: "#33702A",
    warn: "#7D6310",
    danger: "#A8233B",
    onDanger: "#FFFFFF",
  },
  dark: {
    bg: "#0B1429",
    card: "#0E1A3C",
    elevated: "#18264A",
    line: "#25355C",
    soft: "#1A2747",
    fg: "#F0EBE1",
    body: "#C8D0E4",
    muted: "#8A97B8",
    brand: "#B784D6",
    onBrand: "#0E1A3C",
    accent: "#C9A227",
    accentText: "#C9A227",
    ok: "#6FBF5E",
    warn: "#C9A227",
    danger: "#E8788C",
    onDanger: "#0E1A3C",
  },
} as const;

export type Palette = { [K in keyof (typeof palettes)["light"]]: string };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { control: 6, card: 12 } as const;
// Lusail (the web font) ships as woff2 without a licence file in the repo, so the apps use the
// platform font (SF / Roboto / Noto Sans Arabic) — see README "Clients — mobile apps".
export const font = { regular: undefined, size: { xs: 12, sm: 14, md: 16, lg: 20, xl: 28, clock: 44 } } as const;

// Project colours are palette keys on the web (app/styles/mahaam-palette.css); approximate here.
const PROJECT: Record<string, string> = {
  violet: "#8C3FB5", purple: "#8C3FB5", blue: "#3B6FD4", sky: "#2A93C9", cyan: "#1F9EA8", teal: "#1F8F7A",
  green: "#4E9A3E", lime: "#7FA12B", yellow: "#C9A227", amber: "#D08A1E", orange: "#E2661C", red: "#D9455F",
  rose: "#D6457F", pink: "#C8509F", slate: "#6E7891", gray: "#7A7A7A", brown: "#8B5E3C",
};
export const projectColor = (c?: string | null) => (c && (c.startsWith("#") ? c : PROJECT[c])) || "#8C3FB5";
