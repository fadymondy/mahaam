import type { ComponentProps } from "react"

/*
  The CircleXO "OXO" logo, from the brand's own artwork (arts/CircleXO/logo-color.svg), for the
  "Sign in with CircleXO" button. A third-party mark: drawn in its own three colours, never
  recoloured or mirrored (the wordmark reads the same way in Arabic).
*/
export function CircleXOMark({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 876 350" aria-hidden="true" className={className} style={{ height: "1em", width: "auto" }} {...props}>
      <g fill="#8805DD">
        <polygon points="210,70 210,0 70,0 70,70" />
        <polygon points="210,70 210,280 280,280 280,70" />
        <polygon points="70,280 70,350 210,350 210,280" />
        <polygon points="70,140 70,70 0,70 0,280 70,280" />
      </g>
      <g fill="#FF3D64">
        <rect x="526" y="280" width="70" height="70" />
        <rect x="473" y="210" width="70" height="70" />
        <rect x="280" y="280" width="70" height="70" />
        <rect x="333" y="210" width="70" height="70" />
        <polygon points="473,140 543,140 543,70 596,70 596,0 526,0 526,70 473,70" />
        <polygon points="473,210 473,140 403,140 403,70 350,70 350,0 280,0 280,70 333,70 333,140 403,140 403,210" />
      </g>
      <g fill="#00E0B2">
        <polygon points="806,0 666,0 666,70 806,70" />
        <polygon points="806,70 806,280 876,280 876,70" />
        <polygon points="666,71 596,71 596,280 666,280" />
        <polygon points="666,280 666,350 806,350 806,280" />
      </g>
    </svg>
  )
}
