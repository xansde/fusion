/**
 * salvamento.ts — the avatar creator saves by itself.
 *
 * At the table (18/10) the avatar on Bhrotto's document held only the three
 * starting pieces (shadow, body, head) while the token PNG made from the same
 * creator showed a green-skinned figure with hair, belt and flail: the player
 * built the figure, used it as token, and closed the window without pressing
 * "Salvar avatar" — nothing guards a window's close. "Não salva todos os ícones."
 *
 * So the creator does not depend on a button: every edit schedules a save,
 * a burst of edits becomes ONE write of the latest state, writes never overlap
 * (each one chains the version the previous ack confirmed — lib/avatar/
 * escrita.ts), and the pending edit is flushed when the window closes or before
 * "Usar como token" publishes the figure.
 */

export interface OpcoesDaFila<T> {
  /** Quiet time after the last edit before writing, in ms. */
  espera: number;
  gravar: (valor: T) => Promise<void>;
  aoFalhar?: (erro: unknown) => void;
}

export class FilaDeSalvamento<T> {
  private valor: { atual: T } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private voo: Promise<void> | null = null;

  constructor(private readonly opcoes: OpcoesDaFila<T>) {}

  /** True while an edit has not reached the server yet. */
  get pendente(): boolean {
    return this.valor !== null || this.voo !== null;
  }

  /** Record the newest state; it is written after `espera` ms without edits. */
  agendar(valor: T): void {
    this.valor = { atual: valor };
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.executar();
    }, this.opcoes.espera);
  }

  /** Write whatever is pending now, and resolve once everything landed (or failed). */
  async descarregar(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.executar();
  }

  private async executar(): Promise<void> {
    // One write at a time: wait for the one in flight, then write the newest value.
    while (this.voo !== null) await this.voo;
    const proximo = this.valor;
    if (proximo === null) return;
    this.valor = null;
    this.voo = this.opcoes
      .gravar(proximo.atual)
      .catch((erro: unknown) => {
        // Keep it pending unless a newer edit already replaced it.
        if (this.valor === null) this.valor = proximo;
        this.opcoes.aoFalhar?.(erro);
      })
      .finally(() => {
        this.voo = null;
      });
    await this.voo;
  }
}
