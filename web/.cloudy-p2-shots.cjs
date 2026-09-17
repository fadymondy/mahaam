// Cloudy P2 screenshots (temporary helper; uses managy's playwright-core + system Chrome).
// node .cloudy-p2-shots.cjs <base> <outdir> <app>
const { chromium } = require("playwright-core")
const [base, out, appName] = process.argv.slice(2)
const team = "p1-exit-f0a132"
;(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true })
  const report = []
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 }, colorScheme: theme, deviceScaleFactor: 1 })
      await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme)
      const page = await ctx.newPage()
      const errors = []
      page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)))
      await page.goto(`${base}/en/login`, { waitUntil: "networkidle" })
      await page.fill('input[type="email"]', "info@3x1.io")
      await page.fill('input[type="password"]', process.env.PW)
      await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }), page.click('button[type="submit"]')])
      for (const loc of ["en", "ar"]) {
        for (const [name, path] of [["apps", `/t/${team}/apps`], ["app", `/t/${team}/apps/${appName}`], ["new", `/t/${team}/apps/new`]]) {
          await page.goto(`${base}/${loc}${path}`, { waitUntil: "networkidle" }).catch(() => {})
          await page.waitForTimeout(2500)
          const file = `${out}/${name}-${loc}-${theme}-${width}.png`
          await page.screenshot({ path: file, fullPage: false })
          const info = await page.evaluate(() => ({ title: document.title, dir: document.documentElement.dir, dark: document.documentElement.classList.contains("dark"),
            logLines: document.querySelectorAll("[data-seq]").length, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }))
          report.push({ file: file.split("/").pop(), ...info })
        }
      }
      if (errors.length) report.push({ context: `${theme}-${width}`, consoleErrors: [...new Set(errors)].slice(0, 5) })
      await ctx.close()
    }
  }
  await browser.close()
  console.log(JSON.stringify(report, null, 1))
})().catch((e) => { console.error(e); process.exit(1) })
