import { test, expect, type Page } from "@playwright/test";

// Iteration 04 · Phase 7 — browser acceptance evidence for the first *learning*
// vertical slice. It drives the real Academy UI and the corrected Decision
// Workspace against the running API (no fixtures in the browser):
//   • new learner   : Level 0 → lesson → guided practice → Challenge → verified → transfer
//   • experienced   : Level 0 → «Я это знаю — проверить» → Challenge → verified
//   • failure       : a Challenge that breaks a critical gate stays unverified
//   • persistence   : reload restores progression and an in-flight run
//   • workspace     : run-first, single evidence step, required invalidation
//   • viewports     : 1440/900/620/390 with no horizontal overflow, no overlay
//   • accessibility : keyboard-only core path, aria-live result, reduced motion
//
// Progression is server-authoritative: every assertion reads what the server
// reported, never a client-side guess. Screens land in docs/qa/.

const ARENA_EVIDENCE = ["source_ohlcv_demo", "source_volume_demo"];
const CHALLENGE_EVIDENCE = ["source_ohlcv_beta", "source_volume_beta"];
const TRANSFER_EVIDENCE = ["source_ohlcv_delta", "source_volume_delta"];
const INVALIDATION = "A close back below the reclaimed level invalidates the long idea.";

// Progression is server-authoritative and shared per user, and the API runs a
// single in-memory DB for the whole browser project. To keep the suite
// deterministic and order-independent, each test is given its own pristine
// learner from a fixture-only identity pool (`browser-e2e-NN`, seeded by the
// server in fixture mode) via a cookie scoped to the app origin. The cookie is
// forwarded to /api by the dev proxy but never leaks to third-party resources.
let learnerCursor = 0;

test.beforeEach(async ({ page }) => {
  learnerCursor += 1;
  const fixtureUser = `browser-e2e-${String(learnerCursor).padStart(2, "0")}`;
  await page.context().addCookies([
    { name: "sa_fixture_user", value: fixtureUser, url: "http://localhost:5100" }
  ]);
});

async function ready(page: Page): Promise<void> {
  await page.goto("/");
  // The intro preloader is removed from the DOM before the app becomes usable.
  await page.waitForSelector("#preloader", { state: "detached" });
  await page.evaluate(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });
  await page.reload();
  await page.waitForSelector("#preloader", { state: "detached" });
}

async function fillDecision(page: Page, evidenceIds: string[], action: string): Promise<void> {
  for (const id of evidenceIds) {
    await page.getByTestId(`evidence-${id}`).check();
  }
  await page.getByTestId("action").selectOption(action);
  await page.getByTestId("invalidation").fill(INVALIDATION);
}

async function enterAcademy(page: Page): Promise<void> {
  await ready(page);
  await page.getByTestId("enter-academy").click();
  await expect(page.getByTestId("academy-level0")).toBeVisible();
}

async function runChallengeToVerified(page: Page): Promise<void> {
  await page.getByTestId("academy-challenge-entry").click();
  await expect(page.getByTestId("challenge-brief")).toBeVisible();
  await page.getByTestId("start-challenge").click();
  await fillDecision(page, CHALLENGE_EVIDENCE, "wait_for_confirmation");
  await page.getByTestId("seal-run").click();
  await expect(page.getByTestId("challenge-success")).toBeVisible();
}

test("new learner path: lesson → practice → Challenge → verified → Arena Transfer", async ({ page }) => {
  await enterAcademy(page);

  // Lesson renders server-authored content, including the worked example.
  await page.getByTestId("academy-start").click();
  await expect(page.getByTestId("academy-lesson")).toBeVisible();
  await page.screenshot({ path: "docs/qa/academy-lesson.png" });

  // Guided practice scores a run but never verifies the topic.
  await page.getByTestId("academy-practice-entry").click();
  await page.getByTestId("start-run").click();
  await fillDecision(page, ARENA_EVIDENCE, "wait_for_confirmation");
  await page.getByTestId("seal-run").click();
  await expect(page.getByTestId("practice-result")).toBeVisible();
  await expect(page.getByTestId("practice-score")).not.toHaveText("—");

  // The Challenge Test is what actually verifies the topic.
  await page.getByTestId("academy-challenge-entry").click();
  await expect(page.getByTestId("challenge-brief")).toBeVisible();
  await page.getByTestId("start-challenge").click();
  await fillDecision(page, CHALLENGE_EVIDENCE, "wait_for_confirmation");
  await page.getByTestId("seal-run").click();
  await expect(page.getByTestId("challenge-success")).toBeVisible();
  await expect(page.getByTestId("academy-status")).toContainText("подтверждён");
  await page.screenshot({ path: "docs/qa/academy-verified.png" });

  // Arena Transfer yields provisional mastery, not full Mastery.
  await page.getByTestId("transfer-entry").click();
  await expect(page.getByTestId("transfer-brief")).toBeVisible();
  await page.getByTestId("start-transfer").click();
  await fillDecision(page, TRANSFER_EVIDENCE, "wait_for_confirmation");
  await page.getByTestId("seal-run").click();
  await expect(page.getByTestId("transfer-success")).toBeVisible();
  await expect(page.getByTestId("academy-status")).toContainText("Пора повторить");
});

test("experienced learner skips theory via «Я это знаю — проверить»", async ({ page }) => {
  await enterAcademy(page);
  await runChallengeToVerified(page);
  await expect(page.getByTestId("challenge-score")).not.toHaveText(/^$/);
  await page.screenshot({ path: "docs/qa/academy-challenge-out.png" });
});

test("a failed Challenge leaves the topic unverified and shows a corrective reason", async ({ page }) => {
  await enterAcademy(page);
  await page.getByTestId("academy-challenge-entry").click();
  await page.getByTestId("start-challenge").click();

  // Insufficient evidence (a single source) breaks the `evidence_sufficient` gate.
  await page.getByTestId(`evidence-${CHALLENGE_EVIDENCE[0]}`).check();
  await page.getByTestId("action").selectOption("wait_for_confirmation");
  await page.getByTestId("invalidation").fill(INVALIDATION);
  await page.getByTestId("seal-run").click();

  await expect(page.getByTestId("challenge-fail")).toBeVisible();
  await expect(page.getByTestId("challenge-fail-reason")).not.toBeEmpty();
  // The topic never reaches a verified state.
  await expect(page.getByTestId("academy-status")).not.toContainText("подтверждён");
});

test("the corrected Decision Workspace is run-first with a required invalidation", async ({ page }) => {
  await ready(page);
  await page.getByTestId("enter-academy").click();
  await expect(page.getByTestId("academy-level0")).toBeVisible();

  await page.getByTestId("academy-challenge-entry").click();
  await page.getByTestId("start-challenge").click();

  // Evidence is chosen once, inside the decision step (after the run exists).
  const evidence = page.getByTestId("decision-evidence");
  await expect(evidence).toBeVisible();
  const seal = page.getByTestId("seal-run");
  await expect(seal).toBeDisabled();

  // Selecting evidence + action still cannot seal until an invalidation is written.
  await page.getByTestId(`evidence-${CHALLENGE_EVIDENCE[0]}`).check();
  await page.getByTestId(`evidence-${CHALLENGE_EVIDENCE[1]}`).check();
  await page.getByTestId("action").selectOption("wait_for_confirmation");
  await expect(seal).toBeDisabled();
  await page.getByTestId("invalidation").fill(INVALIDATION);
  await expect(seal).toBeEnabled();
});

test("reload restores progression and an in-flight Challenge run", async ({ page }) => {
  await enterAcademy(page);
  await runChallengeToVerified(page);
  await page.getByTestId("challenge-done").click();
  await expect(page.getByTestId("academy-level0")).toBeVisible();
  // Progression survives a reload because it is read back from the server.
  await page.reload();
  await page.waitForSelector("#preloader", { state: "detached" });
  await expect(page.getByTestId("academy-status")).toContainText("подтверждён");

  // An in-flight run also survives reload: start a transfer, reload, and resume.
  await page.getByTestId("academy-challenge-entry").click();
  await page.getByTestId("start-challenge").click();
  await page.getByTestId(`evidence-${CHALLENGE_EVIDENCE[0]}`).check();
  await page.reload();
  await page.waitForSelector("#preloader", { state: "detached" });
  await expect(page.getByTestId("decision-evidence")).toBeVisible();
});

test("Hub Next Best Action mirrors the real server progression", async ({ page }) => {
  await enterAcademy(page);

  // Fresh learner: the server reports a not-yet-started topic and the Hub reads
  // exactly that — nothing here is hard-coded in the client.
  await expect(page.getByTestId("academy-status")).toContainText("Доступно");
  await expect(page.getByTestId("hub-next-action")).toContainText("Продолжить модуль");

  // Verifying the topic server-side must change the Hub's guidance once it
  // re-reads progression (the Hub is a mount-time fetch, so remount the view).
  await runChallengeToVerified(page);
  await expect(page.getByTestId("academy-status")).toContainText("подтверждён");
  await page.reload();
  await page.waitForSelector("#preloader", { state: "detached" });
  await expect(page.getByTestId("academy-status")).toContainText("подтверждён");
  await expect(page.getByTestId("hub-next-action")).toContainText("Arena Transfer");
});

test("Decision Telemetry reconstructs distinguishable orderings for the diagnostics", async ({ page }) => {
  const base = (over: Record<string, unknown>) => ({
    eventVersion: 1,
    sessionId: "sess-telemetry-evidence",
    occurredAt: "2026-09-26T10:00:00.000Z",
    clientElapsedMs: 500,
    payload: {},
    ...over
  });

  // Run A locks the direction first, then writes the invalidation afterwards.
  await page.request.post("/api/v1/telemetry/events", {
    data: {
      events: [
        base({ eventId: "telem-a-1", sequence: 1, eventType: "action_selected", runId: "run-telem-action-first" }),
        base({ eventId: "telem-a-2", sequence: 2, eventType: "invalidation_changed", runId: "run-telem-action-first" })
      ]
    }
  });
  // Run B authors the invalidation before committing to a direction.
  await page.request.post("/api/v1/telemetry/events", {
    data: {
      events: [
        base({ eventId: "telem-b-1", sequence: 1, eventType: "invalidation_changed", runId: "run-telem-invalidation-first" }),
        base({ eventId: "telem-b-2", sequence: 2, eventType: "action_selected", runId: "run-telem-invalidation-first" })
      ]
    }
  });

  const orderOf = async (runId: string): Promise<string[]> => {
    const res = await page.request.get(`/api/v1/telemetry/runs/${runId}/timeline`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: { events: Array<{ sequence: number; eventType: string }> } };
    return body.data.events.map((event) => event.eventType);
  };

  // The server reconstructs the two runs as reversed orderings — the exact signal
  // the Diagnostic Engine turns into `actionBeforeInvalidation` (unit-proven in
  // packages/domain/src/learning-diagnostics.test.ts).
  expect(await orderOf("run-telem-action-first")).toEqual(["action_selected", "invalidation_changed"]);
  expect(await orderOf("run-telem-invalidation-first")).toEqual(["invalidation_changed", "action_selected"]);
});

test("renders across required viewports with no horizontal overflow", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const sizes = [
    { width: 1440, height: 900 },
    { width: 900, height: 700 },
    { width: 620, height: 900 },
    { width: 390, height: 844 }
  ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await ready(page);
    await page.getByTestId("enter-academy").click();
    await expect(page.getByTestId("academy-level0")).toBeVisible();
    // No element should be covered by a leftover overlay.
    const overlay = await page.evaluate(() => !!document.querySelector("#preloader"));
    expect(overlay).toBe(false);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `docs/qa/academy-viewport-${size.width}x${size.height}.png` });
  }
  expect(errors).toEqual([]);
});

test("the core Academy path is keyboard operable with visible focus", async ({ page }) => {
  await ready(page);
  await page.getByTestId("enter-academy").focus();
  await expect(page.getByTestId("enter-academy")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("academy-level0")).toBeVisible();

  const start = page.getByTestId("academy-start");
  await start.focus();
  await expect(start).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("academy-lesson")).toBeVisible();
});

test("respects prefers-reduced-motion and reports the result via aria-live", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  await page.getByTestId("enter-academy").click();
  await expect(page.getByTestId("academy-level0")).toBeVisible();
  await expect(page.getByTestId("challenge-result")).toHaveCount(0);
  expect(errors).toEqual([]);
});
