import { expect, test, type Locator, type Page } from "@playwright/test";
import { STAFF, seedE2eEvent, type E2eEvent } from "./support/event";
import { loginAsStaff, loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });

let ev: E2eEvent;
test.beforeAll(async () => {
  ev = await seedE2eEvent({ slug: "e2e-health", prefix: "J" });
  // A failed heartbeat for this event, as app.tick_all() records one.
  await ev.n.q("insert into error_log (event_id, source, message, context) values ($1, 'tick', 'E2E canary: tick failed', $2)", [
    ev.n.eventId,
    { sqlstate: "XX000" },
  ]);
  // JP02's laptop was last seen five minutes ago.
  const jp02 = ev.n.ev.teams.get("JP02")!;
  await ev.n.q(
    `insert into client_pings (client_id, event_id, user_id, role, team_id, area, realtime, first_seen, last_seen)
     values (gen_random_uuid(), $1, $2, 'TEAM', $3, 'team', 'SUBSCRIBED', now() - interval '20 minutes', now() - interval '5 minutes')`,
    [ev.n.eventId, jp02.userId, jp02.teamId],
  );
});

const panel = (page: Page, title: string | RegExp) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: typeof title === "string" }) });
const statValue = (scope: Locator, label: string) => scope.getByText(label, { exact: true }).locator("xpath=following-sibling::div[1]");

test("health: the heartbeat, connected screens, team screens and teams with none, the error log and this console", async ({ page, browser }) => {
  test.setTimeout(120_000);
  // JF01 opens its portal on another device: the team layout's heartbeat reports the screen.
  const teamContext = await browser.newContext();
  const teamPage = await teamContext.newPage();
  await loginAsTeam(teamPage, ev, "JF01");

  await loginAsStaff(page, ev, STAFF.lead);
  await page.goto(`/admin/${ev.slug}/health`);

  const heartbeat = panel(page, "Heartbeat");
  await expect(heartbeat.getByText("pg_cron: Running every 2 seconds.")).toBeVisible();
  await expect(statValue(heartbeat, "Tick errors, last hour")).toHaveText("1");
  await expect(statValue(heartbeat, "Runs, last 10 min")).not.toHaveText("0");

  const errors = panel(page, "Error log");
  const canary = errors.getByRole("row", { name: /E2E canary: tick failed/ });
  await expect(canary.getByRole("cell").nth(1)).toHaveText("tick");
  await expect(canary.getByRole("cell").nth(3)).toHaveText('{"sqlstate":"XX000"}');

  // JF01's realtime status arrives with its next heartbeat (every 20 s); the page re-reads itself every 10 s.
  const teams = panel(page, "Team screens");
  await expect(teams.getByRole("row", { name: /^JF01/ }).getByRole("cell").nth(3)).toHaveText("SUBSCRIBED", { timeout: 60_000 });
  await expect(teams.getByRole("row", { name: /^JF01/ }).getByRole("cell").nth(1)).toHaveText("Finance");
  await expect(teams.getByText("1 of 9 teams connected")).toBeVisible();

  const silent = panel(page, "No screen in the last 60 seconds (8)");
  await expect(silent.getByText("JP02 · seen 5 min ago")).toBeVisible();
  await expect(silent.getByText("JC01 · never seen")).toBeVisible();
  await expect(silent.getByText(/^JF01 /)).toHaveCount(0);
  await expect(silent.getByRole("list", { name: "Finance teams with no screen" }).getByRole("listitem")).toHaveCount(2);

  const screens = panel(page, "Connected screens");
  await expect(screens.getByRole("row", { name: /^Team portal/ }).getByRole("cell")).toHaveText(["Team portal", "Team", "1", "1 of 1"]);
  await expect(screens.getByRole("row", { name: /^Control panel/ }).getByRole("cell").nth(1)).toHaveText("Organiser");

  // This console: its own realtime channel, the messages it receives, and its clock against the server's.
  const own = panel(page, "This console");
  await expect(own.locator("[data-console-realtime=SUBSCRIBED]")).toBeVisible();
  await expect(own.getByTestId("clock-offset")).toHaveText(/^[+−]\d+ ms$/);
  await expect(own.getByText("none since this page opened")).toBeVisible();
  await ev.n.org("publish_bulletin", ev.n.eventId, "GENERAL", "Health check", "A test bulletin.");
  await expect(own.getByText(/^bulletin · \d+ s ago$/)).toBeVisible();

  // The team closes its portal: a minute later it is listed with no screen.
  await teamContext.close();
  await ev.n.q("update client_pings set last_seen = now() - interval '61 seconds' where team_id = $1", [ev.n.teamId("JF01")]);
  await page.reload();
  await expect(panel(page, "No screen in the last 60 seconds (9)").getByText("JF01 · seen 1 min ago")).toBeVisible();
  await expect(panel(page, "Team screens").getByText("No team screen in the last 60 seconds.")).toBeVisible();
});

test("the fairness officer reads the health view too", async ({ page }) => {
  await loginAsStaff(page, ev, STAFF.fairness);
  await page.goto(`/admin/${ev.slug}/health`);
  await expect(panel(page, "Heartbeat").getByText(/^pg_cron:/)).toBeVisible();
  await expect(panel(page, "Error log").getByRole("row", { name: /E2E canary: tick failed/ })).toBeVisible();
  await expect(panel(page, "This console").locator("[data-console-realtime=SUBSCRIBED]")).toBeVisible();
});
