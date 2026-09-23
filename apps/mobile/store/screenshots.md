# Screenshots

Take them from the release build on the demo workspace (see `review-notes.md`): real-looking
projects, no QA names. Shoot English and Arabic, light mode, plus one dark set if you like.

## Apple

| Device | Size (portrait) | Required |
|---|---|---|
| iPhone 6.9" (iPhone 17/18 Pro Max) | 1320 × 2868 | yes (up to 10) |
| iPad 13" | 2064 × 2752 | yes, because `supportsTablet: true` |

## Google Play

| Asset | Size | Required |
|---|---|---|
| Phone screenshots | 1080 × 2400 (16:9 to 9:16), 2–8 | yes |
| Feature graphic | 1024 × 500 PNG/JPG | yes |
| App icon | 512 × 512 PNG | yes (from `assets/brand`) |
| 7" / 10" tablet screenshots | optional | |

## The set (same order in every language)

1. Projects: the list with project avatars.
2. A project's board: columns and cards.
3. An issue: properties, checklist and the timer running.
4. My work: issues grouped by status.
5. Time: the timesheet week, with the running timer.
6. Inbox: assignments and mentions.
7. Search: results for a query.
8. Customer portal: a project and its requests.
9. Profile: the account and security groups (shows two-step verification and account deletion).
10. Sign in: with Apple, Google and GitHub.

Capture on the simulator with `xcrun simctl io <udid> screenshot` and on the emulator with
`adb exec-out screencap -p`, at the device sizes above. Add no device frames or text overlays
unless they match the app exactly.
