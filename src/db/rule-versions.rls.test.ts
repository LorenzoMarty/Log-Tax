import { beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, type TestUser } from "./test-users";

let a: TestUser;
let b: TestUser;
let user: TestUser;

const propose = (client: TestUser["client"], rule = "iss-limites") =>
  client.rpc("admin_rule_propose", {
    p_rule: rule,
    p_name: "Limites de ISS",
    p_jurisdiction: "Federal",
    p_payload: { min: 0.02, max: 0.06 },
    p_source_url: "https://example.gov.br/lei",
    p_valid_from: "2027-01",
    p_valid_until: null,
    p_confidence: "high",
  });

const hashes = async (id: string) => {
  const { data } = await a.client.rpc("admin_rule_get", { p_version: id });
  return { p: data.payload_hash as string, c: data.cases_hash as string };
};

const evaluate = (id: string, p: string, c: string, passed: boolean) =>
  a.client.rpc("admin_rule_record_evaluation", {
    p_version: id,
    p_payload_hash: p,
    p_cases_hash: c,
    p_passed: passed,
    p_results: [],
  });

beforeAll(async () => {
  [a, b, user] = await Promise.all([
    createTestUser("rules-a"),
    createTestUser("rules-b"),
    createTestUser("rules-user"),
  ]);
  const { error } = await admin
    .from("platform_admins")
    .insert([{ user_id: a.id }, { user_id: b.id }]);
  if (error) throw error;
});

describe("rule versions", () => {
  it("refuses every function to a non-admin and hides the tables", async () => {
    expect((await propose(user.client)).error).not.toBeNull();
    expect((await user.client.rpc("admin_rules_list")).error).not.toBeNull();
    expect(
      (await user.client.from("rule_reference_cases").select()).data ?? [],
    ).toEqual([]);
  });

  it("refuses approval by the proposer, and without a passing evaluation for the exact hashes", async () => {
    const { data: id } = await propose(a.client, "rule-gate-1");
    await a.client.rpc("admin_rule_case_add", {
      p_rule: "rule-gate-1",
      p_name: "c",
      p_competence: "2027-01",
      p_inputs: {},
      p_expected: {},
    });
    const h = await hashes(id);
    // no evaluation yet
    expect(
      (await b.client.rpc("admin_rule_approve", { p_version: id })).error,
    ).not.toBeNull();
    // stale / tampered hash
    expect(
      (await evaluate(id, "0".repeat(64), h.c, true)).error,
    ).not.toBeNull();
    // a failing evaluation does not open the gate
    await evaluate(id, h.p, h.c, false);
    expect(
      (await b.client.rpc("admin_rule_approve", { p_version: id })).error,
    ).not.toBeNull();
    // a passing one does, but never for the proposer
    await evaluate(id, h.p, h.c, true);
    const self = await a.client.rpc("admin_rule_approve", { p_version: id });
    expect(self.error?.message).toContain("same_person");
    // payload tampered after the evaluation: the evaluated hash no longer matches
    await admin
      .from("rule_versions")
      .update({ payload: { min: 0.02, max: 0.99 } })
      .eq("id", id);
    expect(
      (await b.client.rpc("admin_rule_approve", { p_version: id })).error,
    ).not.toBeNull();
    await admin
      .from("rule_versions")
      .update({ payload: { min: 0.02, max: 0.06 } })
      .eq("id", id);
    expect(
      (await b.client.rpc("admin_rule_approve", { p_version: id })).error,
    ).toBeNull();
    const { data: row } = await admin
      .from("rule_versions")
      .select()
      .eq("id", id)
      .single();
    expect(row!.status).toBe("approved");
    expect(row!.approved_by).toBe(b.id);
  });

  it("the table refuses approved_by = created_by even to the service role", async () => {
    const { data: id } = await propose(a.client, "rule-gate-2");
    expect(
      (
        await admin
          .from("rule_versions")
          .update({ status: "approved", approved_by: a.id, approved_hash: "x" })
          .eq("id", id)
      ).error,
    ).not.toBeNull();
  });

  it("ordinary users read only approved rows; rejected never", async () => {
    const { data: id } = await propose(a.client, "rule-gate-3");
    expect(
      (
        await b.client.rpc("admin_rule_reject", {
          p_version: id,
          p_reason: "fonte errada",
        })
      ).error,
    ).toBeNull();
    const seen =
      (await user.client.from("rule_versions").select("rule_id,status")).data ??
      [];
    expect(seen.every((r) => r.status === "approved")).toBe(true);
    expect(seen.find((r) => r.rule_id === "rule-gate-3")).toBeUndefined();
  });

  it("audits each action", async () => {
    const { data: log } = await admin
      .from("audit_log")
      .select()
      .eq("actor_id", a.id)
      .eq("action", "admin_rule_propose");
    expect(log!.length).toBeGreaterThanOrEqual(1);
  });
});
