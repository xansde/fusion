/**
 * @fusion/system-etmos — resolverContestado() tests (REQ-ETM-021, CA-6).
 */
import { describe, it, expect } from "vitest";
import { resolverContestado } from "../contestado.js";
import type { ParticipanteContestado } from "../contestado.js";

function p(overrides: Partial<ParticipanteContestado> = {}): ParticipanteContestado {
  return { total: 8, isPc: true, provocador: false, ...overrides };
}

describe("resolverContestado — vitória clara (REQ-ETM-021)", () => {
  it("higher total wins regardless of provocador/isPc", () => {
    const a = p({ total: 10, isPc: false, provocador: false });
    const b = p({ total: 7, isPc: true, provocador: true });
    const result = resolverContestado(a, b);
    expect(result.vencedor).toBe("a");
    expect(result.motivo).toBe("maiorTotal");
    expect(result.margem).toBe(3);
  });

  it("lower total (b) wins when b.total > a.total", () => {
    const a = p({ total: 5 });
    const b = p({ total: 9 });
    const result = resolverContestado(a, b);
    expect(result.vencedor).toBe("b");
    expect(result.motivo).toBe("maiorTotal");
    expect(result.margem).toBe(-4);
  });
});

describe("resolverContestado — empate com provocador (REQ-ETM-021)", () => {
  it("tied total: the provocador wins", () => {
    const a = p({ total: 8, provocador: true, isPc: false });
    const b = p({ total: 8, provocador: false, isPc: false });
    const result = resolverContestado(a, b);
    expect(result.vencedor).toBe("a");
    expect(result.motivo).toBe("provocadorVenceEmpate");
    expect(result.margem).toBe(0);
  });

  it("tied total: b wins when b is the provocador", () => {
    const a = p({ total: 8, provocador: false });
    const b = p({ total: 8, provocador: true });
    const result = resolverContestado(a, b);
    expect(result.vencedor).toBe("b");
    expect(result.motivo).toBe("provocadorVenceEmpate");
  });
});

describe("resolverContestado — empate PC vs NPC (CA-6)", () => {
  it("CA-6: tied total, both/neither provocador -> PC (a) wins against NPC (b)", () => {
    const a = p({ total: 8, isPc: true, provocador: false });
    const b = p({ total: 8, isPc: false, provocador: false });
    const result = resolverContestado(a, b);
    expect(result.vencedor).toBe("a");
    expect(result.motivo).toBe("pcVenceEmpateContraNpc");
  });

  it("CA-6: tied total, both flagged provocador -> PC (b) wins against NPC (a)", () => {
    const a = p({ total: 8, isPc: false, provocador: true });
    const b = p({ total: 8, isPc: true, provocador: true });
    const result = resolverContestado(a, b);
    expect(result.vencedor).toBe("b");
    expect(result.motivo).toBe("pcVenceEmpateContraNpc");
  });
});

describe("resolverContestado — empate total (D8, Narrador arbitra)", () => {
  it("fully tied (same total, same provocador flag, both PC) -> null vencedor", () => {
    const a = p({ total: 8, isPc: true, provocador: false });
    const b = p({ total: 8, isPc: true, provocador: false });
    const result = resolverContestado(a, b);
    expect(result.vencedor).toBeNull();
    expect(result.motivo).toBe("empate");
  });

  it("fully tied (same total, same provocador flag, both NPC) -> null vencedor", () => {
    const a = p({ total: 5, isPc: false, provocador: true });
    const b = p({ total: 5, isPc: false, provocador: true });
    const result = resolverContestado(a, b);
    expect(result.vencedor).toBeNull();
    expect(result.motivo).toBe("empate");
  });
});
