import { app } from "electron"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { QueueStore } from "@mahaam/client"

/**
 * File-backed storage for the offline write queue.
 *
 * Kept separate from session.json deliberately: that file holds secrets and is encrypted with
 * safeStorage, while this holds ordinary time entries the user typed. Mixing them would mean
 * either encrypting data that does not need it, or storing secrets in a file that does not
 * protect them.
 *
 * Written 0o600 anyway — the payloads describe what someone worked on and when.
 */
const file = () => join(app.getPath("userData"), "queue.json")

export const queueStore: QueueStore = {
  async read() {
    try {
      return existsSync(file()) ? readFileSync(file(), "utf8") : null
    } catch {
      return null
    }
  },
  async write(value: string) {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), value, { mode: 0o600 })
  },
}
