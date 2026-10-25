import assert from "node:assert/strict";
import test from "node:test";
import {
  reportPrompt,
  credentialFilePath,
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

test("local paths isolate origin, port, team and member and cannot traverse parents", () => {
  const target = { team: "team-a", member: "member-a" };
  const path = credentialFilePath("https://COFLOW.example.test:443/", target);
  assert.equal(
    path,
    "~/.coflow/credentials/https%3A%2F%2Fcoflow.example.test/team-a/member-a.token",
  );
  assert.notEqual(
    path,
    credentialFilePath("http://coflow.example.test", target),
  );
  assert.notEqual(
    path,
    credentialFilePath("https://coflow.example.test:8443", target),
  );
  assert.notEqual(
    path,
    credentialFilePath("https://coflow.example.test", {
      ...target,
      team: "team-b",
    }),
  );
  assert.notEqual(
    path,
    credentialFilePath("https://coflow.example.test", {
      ...target,
      member: "member-b",
    }),
  );
  const unusual = credentialFilePath("http://[::1]:3000", {
    team: "../team",
    member: "../../member",
  });
  assert.ok(!unusual.includes("../"));
  assert.ok(unusual.includes("%2E%2E%2Fteam"));
  assert.equal(credentialFilePath("https://coflow.example.test"), null);
  assert.throws(() => credentialFilePath("file:///tmp/service", target));
  assert.throws(() =>
    credentialFilePath("https://user:secret@coflow.example.test", target),
  );
});

test("first-time and daily prompts share an exact path but only setup contains the secret", () => {
  const target = { team: "team-a", member: "member-a" };
  const origin = "http://127.0.0.1:3000";
  const path = credentialFilePath(origin, target);
  const setup = reportPrompt(origin, "cf_test_setup_only", false, target);
  const daily = reportPrompt(origin, "", false, target);
  assert.ok(setup.includes(path) && daily.includes(path));
  assert.ok(setup.includes("cf_test_setup_only"));
  assert.ok(setup.includes("先校验") && setup.includes("校验成功后"));
  assert.ok(
    setup.includes("700") &&
      setup.includes("600") &&
      setup.includes("不直接覆盖"),
  );
  assert.ok(
    !daily.includes("cf_test_setup_only") && !daily.includes("此前提供"),
  );
  assert.ok(daily.includes("按 Skill") && daily.includes("source_id"));
  assert.ok(daily.length < setup.length);
  assert.ok(!reportPrompt(origin, "", true, target).includes(".token"));
});

test("installation and reporting have separate authorization in both languages", () => {
  const target = { team: "synthetic-team", member: "synthetic-member" };
  for (const locale of ["en", "zh-CN"]) {
    const setup = reportPrompt("https://coflow.example.test", "cf_synthetic_install", false, target, locale);
    const daily = reportPrompt("https://coflow.example.test", "", false, target, locale);
    assert.ok(setup.includes("binding.json") && setup.includes("source_id"));
    assert.ok(setup.includes("team_id=synthetic-team") && setup.includes("member_id=synthetic-member"));
    assert.ok(daily.includes(credentialFilePath("https://coflow.example.test", target)));
    assert.ok(!daily.includes("cf_synthetic_install"));
    assert.ok(locale === "en" ? setup.includes("Do not report during installation") : setup.includes("本次只安装，不上报"));
    assert.ok(locale === "en" ? daily.includes("Report to CoFlow") : daily.includes("上报 CoFlow"));
    const incomplete = reportPrompt("https://coflow.example.test", "cf_synthetic_install", false, undefined, locale);
    assert.ok(!incomplete.includes("binding.json"));
  }
});
