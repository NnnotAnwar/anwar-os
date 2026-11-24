// Goals: add a goal for the year, measure it by a number or by its tasks, link
// tasks and projects from their editors, see it on Today under the year ruler.
// Desktop and phone. Fixtures (a task, a project) are inserted for the seeded
// owner through MIGRATION_DATABASE_URL; everything carrying the run tag is
// removed afterwards.
import { randomBytes } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { adminDb, expectNoHorizontalScroll, OWNER, ownerCredentials } from "./support"

test.use({ storageState: OWNER })

const tag = randomBytes(3).toString("hex")
const admin = adminDb()
let ownerId = ""

test.beforeAll(async () => {
  const [owner] = await admin`select id from auth."user" where email = ${ownerCredentials().email}`
  ownerId = owner!.id as string
})

test.afterAll(async () => {
  const like = `%${tag}%`
  await admin`delete from goals_goals where title like ${like}`
  await admin`delete from tasks_tasks where title like ${like}`
  await admin`delete from projects_projects where title like ${like}`
  await admin.end()
})

/** The year the page is showing (the owner's current year). */
async function shownYear(page: Page) {
  return Number(await page.getByRole("navigation", { name: "Year" }).locator("[aria-current=page]").textContent())
}

async function addGoal(page: Page, title: string) {
  await page.goto("/app/goals")
  await page.waitForLoadState("networkidle")
  await page.getByRole("textbox", { name: /New goal for/ }).fill(title)
  await page.keyboard.press("Enter")
  await expect(page.getByText("Goal added")).toBeVisible()
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: title }) })
  await expect(card).toBeVisible()
  return card
}

test("a measured goal: add, set a target, count progress, see it on Today", async ({ page }) => {
  const title = `Read 20 books ${tag}`
  const card = await addGoal(page, title)
  const year = await shownYear(page)
  await expect(card).toContainText("No measure yet")

  await card.getByRole("link", { name: title }).click()
  await expect(page).toHaveURL(/\/app\/goals\/[0-9a-f-]{36}$/)
  await page.getByRole("textbox", { name: "Why it matters" }).fill("Think more clearly.")
  await page.getByRole("radio", { name: "A number" }).click()
  await page.getByRole("textbox", { name: "Target" }).fill("20")
  await page.getByRole("textbox", { name: "Unit" }).fill("books")
  await expect(page.getByRole("status").filter({ hasText: /^Saved / })).toBeVisible()

  const add = page.getByRole("button", { name: "Log one more" })
  await add.click()
  await expect(page.getByRole("textbox", { name: "Done so far" })).toHaveValue("1")
  await add.click()
  await expect(page.getByRole("textbox", { name: "Done so far" })).toHaveValue("2")
  await expect(page.getByRole("progressbar", { name: `${title} progress` })).toHaveAttribute("aria-valuenow", "10")
  await expect(page.locator("main")).toContainText("2 of 20 books")

  // Typing a number sets it outright.
  const done = page.getByRole("textbox", { name: "Done so far" })
  await done.fill("5")
  await done.press("Enter")
  await expect(page.locator("main")).toContainText("5 of 20 books")

  await page.reload()
  await expect(page.getByRole("textbox", { name: "Target" })).toHaveValue("20")
  await expect(page.getByRole("textbox", { name: "Done so far" })).toHaveValue("5")
  await expect(page.getByRole("textbox", { name: "Why it matters" })).toHaveValue("Think more clearly.")

  // The list's card logs one more in one tap.
  await page.goto("/app/goals")
  const listCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: title }) })
  await listCard.getByRole("button", { name: `Log one more for ${title}` }).click()
  await expect(page.getByText("6 books so far")).toBeVisible()
  await expect(listCard).toContainText("6 of 20 books")

  // Today: under the year ruler, with its percentage.
  await page.goto("/app")
  const strip = page.getByRole("region", { name: `Goals for ${year}` })
  await expect(strip.getByRole("link", { name: new RegExp(title) })).toContainText("30%")
  await strip.getByRole("link", { name: new RegExp(title) }).click()
  await expect(page).toHaveURL(/\/app\/goals\/[0-9a-f-]{36}$/)

  // Achieved: filtered under Achieved, full bar.
  await page.getByRole("button", { name: "Mark achieved" }).click()
  await expect(page.getByText("Goal achieved")).toBeVisible()
  await page.goto("/app/goals?status=done")
  const achieved = page.getByRole("article").filter({ has: page.getByRole("heading", { name: title }) })
  await expect(achieved).toContainText("Achieved")
  await expect(achieved.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100")
})

test("a goal measured by tasks: add tasks, link a task and a project from their editors", async ({ page }) => {
  const title = `Ship Shiftella 2 ${tag}`
  await addGoal(page, title)
  const [{ id: goalId }] = await admin<{ id: string }[]>`select id from goals_goals where title = ${title}`
  const [task] = await admin<{ id: string }[]>`
    insert into tasks_tasks (owner_id, title) values (${ownerId}, ${`Write release notes ${tag}`}) returning id`
  const [project] = await admin<{ id: string }[]>`
    insert into projects_projects (owner_id, title, slug) values (${ownerId}, ${`Shiftella app ${tag}`}, ${`shiftella-app-${tag}`}) returning id`
  await admin`insert into tasks_tasks (owner_id, title, project_id, done_at) values (${ownerId}, ${`Fix sign-up ${tag}`}, ${project!.id}, now())`

  // From the goal page: a task in plain words.
  await page.goto(`/app/goals/${goalId}`)
  await page.getByRole("textbox", { name: "New task for this goal" }).fill(`Record the demo ${tag}`)
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByText("Task added to this goal")).toBeVisible()
  const tasks = page.getByRole("list", { name: "Tasks counting towards this goal" })
  await expect(tasks).toContainText(`Record the demo ${tag}`)
  await expect(page.locator("main")).toContainText("0 of 1 task")

  // The task editor's Goal picker.
  await page.goto(`/app/tasks?task=${task!.id}`)
  const sheet = page.getByRole("dialog", { name: "Task details" })
  const picker = sheet.getByRole("combobox", { name: "Goal" })
  await expect(picker).toBeEnabled()
  await picker.selectOption({ label: title })
  await expect(page.getByText(`Counts towards “${title}”`)).toBeVisible()

  // The project editor's Goal picker brings the project's tasks along.
  await page.goto(`/app/projects/${project!.id}`)
  const projectPicker = page.getByRole("combobox", { name: "Goal" })
  await expect(projectPicker).toBeEnabled()
  await projectPicker.selectOption({ label: title })
  await expect(page.getByText(`Counts towards “${title}”`)).toBeVisible()

  await page.goto(`/app/goals/${goalId}`)
  await expect(page.getByRole("list", { name: "Linked projects" })).toContainText(`Shiftella app ${tag}`)
  await expect(tasks).toContainText(`Write release notes ${tag}`)
  await expect(tasks).toContainText(`via Shiftella app ${tag}`)
  await expect(page.locator("main")).toContainText("1 of 3 tasks")

  // Unlinking the project takes its tasks off again.
  await page.getByRole("button", { name: `Unlink Shiftella app ${tag}` }).click()
  await expect(page.locator("main")).toContainText("0 of 2 tasks")
  await expect(page.getByRole("list", { name: "Linked projects" })).toHaveCount(0)

  // The picker shows the current goal when reopened.
  await page.goto(`/app/tasks?task=${task!.id}`)
  await expect(page.getByRole("dialog", { name: "Task details" }).getByRole("combobox", { name: "Goal" })).toHaveValue(goalId)
})

test("the card menu reorders, drops and deletes with Undo", async ({ page }) => {
  const first = `First ${tag}`
  const second = `Second ${tag}`
  await addGoal(page, first)
  await addGoal(page, second)
  const titles = () => page.getByRole("article").getByRole("heading").allTextContents()
  const mine = async () => (await titles()).filter((t) => t.endsWith(tag) && (t.startsWith("First") || t.startsWith("Second")))
  expect(await mine()).toEqual([first, second])

  const secondCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: second }) })
  await secondCard.getByRole("button", { name: `Options for ${second}` }).click()
  await page.getByRole("menuitem", { name: "Move up" }).click()
  await expect.poll(mine).toEqual([second, first])
  await page.reload()
  await expect.poll(mine).toEqual([second, first])

  const firstCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: first }) })
  await firstCard.getByRole("button", { name: `Options for ${first}` }).click()
  await page.getByRole("menuitem", { name: "Drop" }).click()
  await expect(firstCard).toContainText("Dropped")

  await firstCard.getByRole("button", { name: `Options for ${first}` }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await expect(firstCard).toHaveCount(0)
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: first }) })).toBeVisible()

  await page.getByRole("article").filter({ has: page.getByRole("heading", { name: first }) }).getByRole("button", { name: `Options for ${first}` }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await expect
    .poll(async () => (await admin`select count(*)::int as n from goals_goals where title = ${first}`)[0]!.n, { timeout: 10_000 })
    .toBe(0)
})

test.describe("phone", () => {
  test.use({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  })

  test("goals page, editor and Today fit the screen with comfortable taps", async ({ page }) => {
    const title = `Run 500 km this year with a long title ${tag}`
    const card = await addGoal(page, title)
    await expectNoHorizontalScroll(page)
    const options = card.getByRole("button", { name: `Options for ${title}` })
    expect((await options.boundingBox())!.height).toBeGreaterThanOrEqual(44)

    await card.getByRole("link", { name: title }).click()
    await page.getByRole("radio", { name: "A number" }).click()
    await page.getByRole("textbox", { name: "Target" }).fill("500")
    await page.getByRole("textbox", { name: "Unit" }).fill("km")
    await expect(page.getByRole("status").filter({ hasText: /^Saved / })).toBeVisible()
    await expectNoHorizontalScroll(page)
    for (const name of ["Take one off", "Log one more"]) {
      expect((await page.getByRole("button", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await page.getByRole("button", { name: "Log one more" }).click()
    await expect(page.getByRole("textbox", { name: "Done so far" })).toHaveValue("1")

    await page.goto("/app/goals")
    await page.goto("/app")
    const row = page.getByRole("region", { name: /^Goals for / }).getByRole("link", { name: new RegExp(title) })
    await expect(row).toBeVisible()
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expectNoHorizontalScroll(page)
  })
})
