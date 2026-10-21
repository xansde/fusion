import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilaDeSalvamento } from "../salvamento.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function criar(gravar: (v: number) => Promise<void>, espera = 500) {
  return new FilaDeSalvamento<number>({ espera, gravar });
}

describe("FilaDeSalvamento", () => {
  it("coalesces a burst of edits into one write of the LAST value", async () => {
    const gravadas: number[] = [];
    const fila = criar(async (v) => {
      gravadas.push(v);
    });
    fila.agendar(1);
    fila.agendar(2);
    fila.agendar(3);
    expect(gravadas).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(gravadas).toEqual([3]);
  });

  it("never runs two writes at once; an edit during a write is written after it", async () => {
    let emVoo = 0;
    let maximo = 0;
    const gravadas: number[] = [];
    let liberar: () => void = () => {};
    const fila = criar(async (v) => {
      emVoo++;
      maximo = Math.max(maximo, emVoo);
      await new Promise<void>((r) => {
        liberar = r;
      });
      gravadas.push(v);
      emVoo--;
    });
    fila.agendar(1);
    await vi.advanceTimersByTimeAsync(500);
    fila.agendar(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(maximo).toBe(1);
    liberar();
    await vi.advanceTimersByTimeAsync(0);
    liberar();
    await vi.advanceTimersByTimeAsync(0);
    expect(gravadas).toEqual([1, 2]);
    expect(maximo).toBe(1);
  });

  it("descarregar writes a pending edit at once and resolves when it landed", async () => {
    const gravadas: number[] = [];
    const fila = criar(async (v) => {
      gravadas.push(v);
    });
    fila.agendar(7);
    await fila.descarregar();
    expect(gravadas).toEqual([7]);
    expect(fila.pendente).toBe(false);
  });

  it("descarregar with nothing pending is a no-op", async () => {
    const gravar = vi.fn(async () => {});
    await criar(gravar).descarregar();
    expect(gravar).not.toHaveBeenCalled();
  });

  it("a failed write is reported and the value stays pending for the next try", async () => {
    let falhar = true;
    const gravadas: number[] = [];
    const erros: unknown[] = [];
    const fila = new FilaDeSalvamento<number>({
      espera: 500,
      gravar: async (v) => {
        if (falhar) throw new Error("offline");
        gravadas.push(v);
      },
      aoFalhar: (e) => erros.push(e),
    });
    fila.agendar(5);
    await vi.advanceTimersByTimeAsync(500);
    expect(erros).toHaveLength(1);
    expect(fila.pendente).toBe(true);
    falhar = false;
    await fila.descarregar();
    expect(gravadas).toEqual([5]);
    expect(fila.pendente).toBe(false);
  });
});
