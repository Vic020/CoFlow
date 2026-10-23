import assert from "node:assert/strict";
import test from "node:test";
import {
  reportPrompt,
  hasActiveReportToken,
} from "../apps/web/lib/report-prompt.ts";

test("repeat prompt contains identity and no empty or invented credential", () => {
  const prompt = reportPrompt("https://coflow.example.test", "", false, {
    team: "team-b",
    member: "member-vic",
  });
  assert.ok(
    prompt.includes("https://coflow.example.test/agent/coflow-report/SKILL.md"),
  );
  assert.ok(
    prompt.includes("team_id=team-b") &&
      prompt.includes("member_id=member-vic"),
  );
  assert.ok(prompt.includes("COFLOW_TOKEN"));
  assert.ok(!prompt.includes("我的凭证是"));
});
test("initial prompt can use a supplied credential; demo never includes it", () => {
  const secret = "cf_unit_test_only";
  assert.ok(
    reportPrompt("http://127.0.0.1:3000", secret, false).includes(secret),
  );
  assert.ok(
    !reportPrompt("http://127.0.0.1:3000", secret, true).includes(secret),
  );
});
test("only unexpired, unrevoked reporting tokens enable quick reporting", () => {
  const now = Date.parse("2026-10-24T00:00:00Z");
  const valid = {
    scopes: ["reports:write"],
    expires_at: "2026-11-01T00:00:00Z",
    revoked_at: null,
  };
  assert.equal(hasActiveReportToken([valid], now), true);
  for (const token of [
    { ...valid, scopes: ["reports:read"] },
    { ...valid, revoked_at: "2026-10-23T00:00:00Z" },
    { ...valid, expires_at: "2026-10-24T00:00:00Z" },
    { ...valid, expires_at: "invalid" },
  ])
    assert.equal(hasActiveReportToken([token], now), false);
  assert.equal(hasActiveReportToken([], now), false);
});
