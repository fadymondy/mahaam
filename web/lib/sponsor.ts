// Sponsoring open source (2026-10-15): Mahaam is free and open source. Nothing is sold and no feature
// is behind a plan; people who want to support the work sponsor it instead, through to-go.dev/sponsor
// (ToGO is the framework Mahaam is built on), GitHub Sponsors, Polar or Open Collective.
//
// Links come from the environment so a provider shows up the day its account exists and disappears if
// it is turned off. Unset means "not there yet" and the page leaves it out. Only to-go.dev/sponsor and
// GitHub Sponsors have defaults, because they are live today. Same shape as the CircleXO hub's lib.

export type SponsorProvider = "github_sponsors" | "polar" | "open_collective" | "custom"
export type SponsorLink = { key: SponsorProvider; href: string; label: string }

const PROVIDERS: { key: SponsorProvider; label: [en: string, ar: string] }[] = [
  { key: "custom", label: ["Sponsor ToGO", "ادعم ToGO"] },
  { key: "github_sponsors", label: ["GitHub Sponsors", "GitHub Sponsors"] },
  { key: "polar", label: ["Polar", "Polar"] },
  { key: "open_collective", label: ["Open Collective", "Open Collective"] },
]

const env = (v: string | undefined, fallback = "") => (v ?? fallback).trim()

/** Mahaam's sponsor links (Fady Mondy, «فادي مندي»). Empty values are not shown. */
const LINKS: Partial<Record<SponsorProvider, string>> = {
  custom: env(process.env.NEXT_PUBLIC_SPONSOR_URL, "https://to-go.dev/sponsor"),
  github_sponsors: env(process.env.NEXT_PUBLIC_SPONSOR_GITHUB, "https://github.com/sponsors/fadymondy"),
  polar: env(process.env.NEXT_PUBLIC_SPONSOR_POLAR),
  open_collective: env(process.env.NEXT_PUBLIC_SPONSOR_OPEN_COLLECTIVE),
}

/** The links to show, in order. Only https URLs are shown. */
export function sponsorLinks(ar: boolean): SponsorLink[] {
  return PROVIDERS.flatMap(({ key, label }) => {
    const href = LINKS[key]
    return href && /^https:\/\//.test(href) ? [{ key, href, label: ar ? label[1] : label[0] }] : []
  })
}
