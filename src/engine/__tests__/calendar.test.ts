import { describe, expect, it } from "vitest";
import { isBusinessDay, nextBusinessDay, upcomingDeadlines } from "../calendar";

describe("obligations calendar", () => {
  it("Simples company gets the DAS of the month with the holiday adjustment (20/11/2026 is a national holiday)", () => {
    const { deadlines } = upcomingDeadlines({ regime: "simples" }, "2026-11-01", 40);
    const das = deadlines.find((d) => d.id === "das");
    expect(das).toMatchObject({ date: "2026-11-23", competence: "2026-10", requiresValidation: true });
    expect(das?.source).toContain("receita.fazenda.gov.br");
  });

  it("moves weekends and holidays to the next business day", () => {
    expect(isBusinessDay("2026-11-20")).toBe(false); // Consciência Negra, Lei 14.759/2023
    expect(isBusinessDay("2023-11-20")).toBe(true); // not a holiday before 2024
    expect(nextBusinessDay("2026-12-19")).toBe("2026-12-21"); // Saturday
    expect(nextBusinessDay("2026-11-02")).toBe("2026-11-03"); // Finados
  });

  it("DASN-SIMEI is not moved when 31/05 is not a business day (2026-05-31 is a Sunday)", () => {
    const { deadlines } = upcomingDeadlines({ regime: "mei" }, "2026-05-01", 40);
    expect(deadlines.find((d) => d.id === "dasn-simei")?.date).toBe("2026-05-31");
  });

  it("only lists obligations of the regime, sorted, inside the horizon, and says what is not covered", () => {
    const r = upcomingDeadlines({ regime: "presumido" }, "2026-11-13", 30);
    expect(r.deadlines.map((d) => d.id)).toEqual(["dctfweb"]);
    expect(r.deadlines[0].date).toBe("2026-11-16"); // 15/11 is a Sunday
    expect(r.notCovered).toContain("DARF de IRPJ e CSLL");
    expect(r.holidayScope).toBe("nacional");
  });

  it("DIRPF has a date only for the published year", () => {
    expect(upcomingDeadlines({ regime: "presumido" }, "2026-05-10", 30).deadlines.map((d) => d.id)).toContain("dirpf");
    expect(upcomingDeadlines({ regime: "presumido" }, "2027-05-10", 30).deadlines.map((d) => d.id)).not.toContain("dirpf");
  });
});
