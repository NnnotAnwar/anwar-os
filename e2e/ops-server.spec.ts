// Ops → Server: the host's vitals from a fake ops-agent (GET /host, GET
// /services) on OPS_AGENT_URL, the problems line, and the Telegram alert
// settings (switch a kind off and on, mute and unmute). `pnpm e2e` points the
// app at the fake; against your own server, set OPS_AGENT_URL/SECRET the same
// way or the spec skips.
import { createHmac, createHash } from "node:crypto"
import { createServer, type Server } from "node:http"
import { expect, test } from "@playwright/test"
import { OWNER } from "./support"

test.use({ storageState: OWNER })

const agentUrl = process.env.OPS_AGENT_URL
const secret = process.env.OPS_AGENT_SECRET ?? ""
test.skip(!agentUrl || secret.length < 32, "needs OPS_AGENT_URL and OPS_AGENT_SECRET (pnpm e2e sets them)")

const GB = 1024 ** 3
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

const host = () => ({
  time: new Date().toISOString(),
  hostname: "anwar-os",
  os: "Ubuntu 24.04.1 LTS",
  kernel: "6.8.0-49-generic",
  arch: "aarch64",
  cpus: 2,
  docker_version: "28.0.1",
  uptime_seconds: 4 * 86_400,
  boot_time: hoursAgo(96),
  load: [0.42, 0.3, 0.25],
  memory: {
    total_bytes: 4 * GB,
    available_bytes: 2.5 * GB,
    used_bytes: 1.5 * GB,
    swap_total_bytes: 2 * GB,
    swap_used_bytes: 0.25 * GB,
    psi_some_avg60: 0.4,
    psi_full_avg60: 0,
  },
  disk: { path: "/", total_bytes: 38 * GB, used_bytes: 34.6 * GB, available_bytes: 3.4 * GB, used_percent: 91.1 },
  docker_disk: {
    images_bytes: 7 * GB,
    images: 31,
    unused_images: 22,
    containers_bytes: 0.1 * GB,
    containers: 6,
    volumes_bytes: 0.6 * GB,
    volumes: 3,
    build_cache_bytes: 0,
    total_bytes: 7.7 * GB,
  },
  reboot: { required: true, since: hoursAgo(5), packages: ["linux-image-6.8.0-50-generic"] },
  backup: {
    last: { status: "failed", started_at: hoursAgo(9), finished_at: hoursAgo(9), offsite: false, error: "failed while uploading (exit 1)" },
    last_success: { status: "ok", finished_at: hoursAgo(33), file: "anwar_os-x.dump.age", size_bytes: 5_242_880, offsite: true },
  },
  sites: [],
  errors: {},
})

const services = [
  {
    name: "web",
    container: "anwar-os-web-1",
    image: "ghcr.io/nnnotanwar/anwar-os-web",
    tag: "latest",
    state: "running",
    health: "healthy",
    started_at: hoursAgo(2),
    exit_code: 0,
    restart_count: 0,
    protected: true,
    role: "app",
    cpu_percent: 1.2,
    mem_bytes: 200 * 1024 ** 2,
    mem_limit_bytes: GB,
  },
]

/** The agent's check, so the test also proves web signs GET /host. */
function signedOk(method: string, path: string, headers: Record<string, string | string[] | undefined>) {
  const ts = String(headers["x-os-timestamp"] ?? "")
  const nonce = String(headers["x-os-nonce"] ?? "")
  const payload = `v1\n${ts}\n${nonce}\n${method}\n${path}\n${createHash("sha256").update("").digest("hex")}`
  return headers["x-os-signature"] === `v1=${createHmac("sha256", secret).update(payload).digest("hex")}`
}

let agent: Server | undefined
const hostCalls: string[] = []

test.beforeAll(async () => {
  agent = createServer((req, res) => {
    res.setHeader("content-type", "application/json")
    if (!signedOk(req.method ?? "GET", req.url ?? "", req.headers)) {
      res.writeHead(401).end(JSON.stringify({ error: "unauthorized", message: "bad signature" }))
      return
    }
    if (req.url === "/host") {
      hostCalls.push(req.url)
      res.end(JSON.stringify({ host: host(), agent: { version: "e2e" } }))
    } else if (req.url?.startsWith("/services")) {
      res.end(JSON.stringify({ services, agent: { version: "e2e" } }))
    } else {
      res.writeHead(404).end(JSON.stringify({ error: "not_found", message: "no such thing" }))
    }
  })
  const port = Number(new URL(agentUrl!).port)
  await new Promise<void>((resolve) => agent!.listen(port, "127.0.0.1", resolve))
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => (agent ? agent.close(() => resolve()) : resolve()))
})

test("shows the server's vitals and what needs attention", async ({ page }) => {
  await page.goto("/app/ops")
  const server = page.getByRole("region", { name: "Server" })
  await expect(server.getByRole("heading", { name: "Server" })).toBeVisible()
  expect(hostCalls.length).toBeGreaterThan(0)

  await expect(server.getByTestId("server-identity")).toHaveText("anwar-os · Ubuntu 24.04.1 LTS · up 4 d")

  // The problems line uses the alert rules: disk over 85 %, failed backup.
  const problems = server.getByRole("status", { name: "Server problems" })
  await expect(problems).toContainText("2 problems")
  await expect(problems).toContainText("Disk 91 % full")
  await expect(problems).toContainText("Last backup failed")

  const disk = server.getByRole("article", { name: "Disk" })
  await expect(disk).toContainText("91 %")
  await expect(disk).toContainText("Needs attention")
  await expect(disk.getByRole("meter", { name: "Disk used" })).toHaveAttribute("aria-valuenow", "91")

  await expect(server.getByRole("article", { name: "Memory" })).toContainText("2.5 GB available")
  await expect(server.getByRole("article", { name: "System" }).getByTestId("reboot-status")).toContainText(
    /pending for 5 h.* · linux-image-6\.8\.0-50-generic/,
  )
  const backup = server.getByRole("article", { name: "Backup" })
  await expect(backup).toContainText("Last backup failed")
  await expect(backup).toContainText("failed while uploading (exit 1)")
  await expect(server.getByRole("article", { name: "Docker" })).toContainText("22 unused")
  // The e2e site is plain http on localhost and the fake lists no sites.
  await expect(server.getByRole("article", { name: "Certificates" })).toContainText("No HTTPS sites to check here.")
})

test("fits a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/app/ops#server")
  await expect(page.getByRole("article", { name: "Certificates" })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  // Mute buttons stay comfortable to tap.
  const box = await page.getByRole("region", { name: "Telegram alerts" }).getByRole("button", { name: "1 h" }).boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
})

test("switches an alert kind off and on, and mutes alerts with Undo", async ({ page }) => {
  await page.goto("/app/ops")
  const card = page.getByRole("region", { name: "Telegram alerts" })
  await expect(card).toContainText("osbot isn't set up")

  const diskSwitch = card.getByRole("switch", { name: "Disk" })
  await expect(diskSwitch).toBeChecked()
  await diskSwitch.uncheck()
  await expect(page.getByText("Disk alerts off")).toBeVisible()
  await page.reload()
  await expect(page.getByRole("region", { name: "Telegram alerts" }).getByRole("switch", { name: "Disk" })).not.toBeChecked()
  await page.getByRole("region", { name: "Telegram alerts" }).getByRole("switch", { name: "Disk" }).check()
  await expect(page.getByText("Disk alerts on")).toBeVisible()

  const alerts = page.getByRole("region", { name: "Telegram alerts" })
  await alerts.getByRole("button", { name: "8 h" }).click()
  await expect(page.getByText("Alerts muted for 8 h")).toBeVisible()
  await expect(alerts.getByTestId("alerts-mute")).toContainText("Muted until")
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(alerts.getByRole("button", { name: "8 h" })).toBeVisible()

  await alerts.getByRole("button", { name: "1 h" }).click()
  await expect(alerts.getByTestId("alerts-mute")).toContainText("Muted until")
  await alerts.getByRole("button", { name: "Unmute" }).click()
  await expect(page.getByText("Alerts unmuted")).toBeVisible()
  await expect(alerts.getByRole("button", { name: "1 h" })).toBeVisible()
})
