<script lang="ts">
  /**
   * AvatarCreator.svelte — the avatar creation popup.
   *
   * Opened from the character sheet as its own window
   * (singletonKey `avatar:Actor:<id>`), because the creator needs room: the
   * acervo offers 627 pieces across 11 groups and ~100 slots, and the piece grid
   * composes the WHOLE character in every cell so the player judges the piece in
   * context instead of on a blank doll.
   *
   * Navigation is two levels — tab per group, then one slot at a time — for the
   * same reason the acervo has both: a tab like "Torso" holds 17 slots, and a
   * flat list of 100 slots is not something anyone scans.
   *
   * The grid cells are STILL sprites; only the preview animates. Ninety
   * animation loops would cost real frames to say nothing extra.
   *
   * Saving is one pruned `doc:update` (lib/avatar/patch.ts). The socket is
   * resolved LIVE at click time via getSocket(), never captured as a prop — a
   * window's componentProps are frozen at open time and would outlive a
   * reconnect (the frozen-socket bug documented in CharacterSheet.svelte).
   */

  import type { Catalogo, Item, Selecao } from "waybuilder-avatar";
  import { readImagemAnterior, type AvatarFlag } from "@fusion/shared";
  import { AcervoIndisponivel, carregarCatalogo, carregarCreditos, garantirPaletas, paletasCarregadas, type Creditos } from "$lib/avatar/acervo.js";
  import { arquivosDePaletaDoCatalogo } from "$lib/avatar/paletas.js";
  import { ANIMACAO_PADRAO, animacaoDisponivel } from "$lib/avatar/animacao.js";
  import {
    abasDoCatalogo,
    canaisDaPeca,
    corSelecionada,
    definirCor,
    normalizarSelecao,
    paraFlag,
    rotuloDaAnimacao,
    rotuloDoCorpo,
    rotuloDoItem,
    selecaoInicial,
    semArteNoCorpo,
    trocarPeca,
    type AbaDoCriador,
    type CanalDoCriador,
  } from "$lib/avatar/criador.js";
  import { diffDoAvatar } from "$lib/avatar/patch.js";
  import { renderizarMiniatura, type ModoMiniatura } from "$lib/avatar/miniatura.js";
  import { publicarMiniatura } from "$lib/avatar/publicarMiniatura.js";
  import { liberarPixelsDoAvatar } from "$lib/avatar/desenhar.js";
  import { getSocket } from "$lib/session.svelte.js";
  import { atualizarAtor } from "$lib/avatar/escrita.js";
  import { FilaDeSalvamento } from "$lib/avatar/salvamento.js";
  import { caminhoDeArteValido, podeRestaurar, precisaConfirmarSubstituicao } from "$lib/avatar/imagemDoAtor.js";
  import { worldMirror } from "$lib/docs/worldSync.js";
  import ActorPortrait from "$lib/components/common/ActorPortrait.svelte";
  import AvatarOverlayControles from "./AvatarOverlayControles.svelte";
  import { t } from "$lib/i18n/i18n.js";
  import AvatarSprite from "./AvatarSprite.svelte";

  interface Props {
    actorId: string;
    nome: string;
    /** Avatar currently on the document, or null. */
    avatarAtual: AvatarFlag | null;
    /** False for a spectator: the creator becomes read-only. */
    podeEditar: boolean;
    onFechar?: () => void;
  }

  let { actorId, nome, avatarAtual, podeEditar, onFechar = () => {} }: Props = $props();

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  let catalogo: Catalogo | null = $state(null);
  let abas: AbaDoCriador[] = $state([]);
  let erro: string | null = $state(null);
  /** Bumped when palette files land, so the colour pickers recompute. */
  let paletasVersao = $state(0);

  let corpo = $state("male");
  let selecao: Selecao = $state({});
  let animacao = $state(ANIMACAO_PADRAO);
  let grupoAtivo = $state("");
  let slotAtivo = $state("");
  let busca = $state("");
  let descartados: string[] = $state([]);

  /** The avatar as it is on the document — the baseline the save diff prunes against. */
  let baseline: AvatarFlag | null = $state(avatarAtual);
  let sujo = $state(false);
  let salvando = $state(false);
  let mensagem: string | null = $state(null);

  let creditos: Creditos | null = $state(null);
  let mostrarCreditos = $state(false);

  $effect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const cat = await carregarCatalogo();
        // The colour picker lists a channel's ramps before anything is equipped,
        // so the palettes have to be in hand before the first render.
        await garantirPaletas(arquivosDePaletaDoCatalogo(cat));
        if (cancelado) return;

        const normalizada = normalizarSelecao(cat, avatarAtual);
        catalogo = cat;
        abas = abasDoCatalogo(cat);
        corpo = normalizada.corpo;
        selecao = normalizada.selecao;
        descartados = normalizada.descartados;
        animacao = animacaoDisponivel(cat, ANIMACAO_PADRAO);
        grupoAtivo = abas[0]?.grupo ?? "";
        slotAtivo = abas[0]?.slots[0]?.slot ?? "";
        paletasVersao++;
      } catch (e) {
        if (cancelado) return;
        erro =
          e instanceof AcervoIndisponivel
            ? t("FUSION.Avatar.Error.Acervo")
            : t("FUSION.Avatar.Error.Unknown");
      }
    })();
    return () => {
      cancelado = true;
    };
  });

  // The creator is the heavy user of the pixel caches (a grid warms dozens of
  // atlases); drop them when it closes so the table does not carry the cost.
  $effect(() => () => liberarPixelsDoAvatar());

  // ---------------------------------------------------------------------------
  // Derived view
  // ---------------------------------------------------------------------------

  const aba = $derived(abas.find((a) => a.grupo === grupoAtivo) ?? abas[0]);
  const slots = $derived(aba?.slots ?? []);
  const slotAtual = $derived(slots.find((s) => s.slot === slotAtivo) ?? slots[0]);

  const itensVisiveis = $derived.by((): Item[] => {
    const lista = slotAtual?.itens ?? [];
    const termo = busca.trim().toLowerCase();
    if (termo === "") return lista;
    return lista.filter((i) => rotuloDoItem(i).toLowerCase().includes(termo));
  });

  const equipadoNoSlot = $derived.by((): Item | null => {
    const escolha = slotAtual === undefined ? undefined : selecao[slotAtual.slot];
    if (escolha === undefined) return null;
    return slotAtual?.itens.find((i) => i.id === escolha.id) ?? null;
  });

  const canais = $derived.by((): CanalDoCriador[] => {
    void paletasVersao;
    const item = equipadoNoSlot;
    if (catalogo === null || item === null) return [];
    return canaisDaPeca(catalogo, item, corpo, paletasCarregadas());
  });

  /** Equipped pieces, for the summary column. */
  const equipados = $derived.by(() => {
    if (catalogo === null) return [];
    const porId = new Map(catalogo.itens.map((i) => [i.id, i]));
    return Object.entries(selecao)
      .map(([slot, escolha]) => ({
        slot,
        rotulo: catalogo?.slots?.[slot] ?? slot,
        item: porId.get(escolha.id),
      }))
      .filter((e) => e.item !== undefined)
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  });

  /** The selection as it would be with `item` in the active slot. */
  function selecaoCom(item: Item | null): Selecao {
    if (slotAtual === undefined) return selecao;
    return trocarPeca(selecao, slotAtual.slot, item === null ? null : item.id);
  }

  // ---------------------------------------------------------------------------
  // Edits
  // ---------------------------------------------------------------------------

  /**
   * Every edit saves by itself (lib/avatar/salvamento.ts): at the table a figure
   * built, used as token and then closed without "Salvar avatar" was lost — only
   * the three starting pieces were on the document.
   */
  function editou(): void {
    sujo = true;
    mensagem = null;
    if (catalogo === null) return;
    ultimoAgendado = paraFlag(catalogo, corpo, selecao);
    fila.agendar(ultimoAgendado);
  }

  function escolher(item: Item | null): void {
    if (!podeEditar || slotAtual === undefined) return;
    selecao = selecaoCom(item);
    editou();
  }

  function pintar(canal: CanalDoCriador, valor: string): void {
    if (!podeEditar || slotAtual === undefined) return;
    selecao = definirCor(selecao, slotAtual.slot, canal.nome, valor);
    editou();
  }

  function trocarCorpo(novo: string): void {
    if (!podeEditar) return;
    corpo = novo;
    editou();
  }

  function recomecar(): void {
    if (!podeEditar || catalogo === null) return;
    selecao = selecaoInicial(catalogo, corpo);
    editou();
  }

  function tirar(slot: string): void {
    if (!podeEditar) return;
    selecao = trocarPeca(selecao, slot, null);
    editou();
  }

  // ---------------------------------------------------------------------------
  // Save / remove
  // ---------------------------------------------------------------------------

  /** The newest state handed to the queue — `sujo` clears only once THAT one landed. */
  let ultimoAgendado: AvatarFlag | null = null;

  async function gravar(novo: AvatarFlag | null): Promise<void> {
    const socket = getSocket();
    if (socket === null) throw new Error("offline");
    salvando = true;
    try {
      await atualizarAtor(socket, actorId, diffDoAvatar(baseline, novo));
      baseline = novo;
      if (novo === ultimoAgendado) sujo = false;
    } finally {
      salvando = false;
    }
  }

  const fila = new FilaDeSalvamento<AvatarFlag | null>({
    espera: 600,
    gravar,
    aoFalhar: () => {
      mensagem = getSocket() === null ? t("FUSION.Avatar.Error.Offline") : t("FUSION.Avatar.Error.Save");
    },
  });

  // Closing the window flushes the pending edit: the socket outlives the window.
  $effect(() => () => {
    void fila.descarregar();
  });

  async function salvar(): Promise<void> {
    if (!podeEditar) return;
    await fila.descarregar();
    if (!sujo) mensagem = t("FUSION.Avatar.Saved");
  }

  async function remover(): Promise<void> {
    if (!podeEditar) return;
    ultimoAgendado = null;
    fila.agendar(null);
    await fila.descarregar();
    if (baseline === null) mensagem = t("FUSION.Avatar.Removed");
    // The fresh doll is NOT scheduled: saving it would bring the avatar back.
    if (catalogo !== null) selecao = selecaoInicial(catalogo, corpo);
  }

  // ---------------------------------------------------------------------------
  // "Usar como token / retrato" — render the current preview to a square PNG,
  // publish it to the asset library (tokens tab) and set it as the actor's art.
  // A token has no art of its own (REQ-TOK-010/011): it IS the actor's `img`, so
  // this one write reaches every token of the actor and the sheet portrait.
  // ---------------------------------------------------------------------------

  /** The actor as the mirror has it NOW — its `img` and the server-kept previous one. */
  let atorVivo: Record<string, unknown> | null = $state(null);
  $effect(() => {
    const ler = () => {
      atorVivo = worldMirror.getDoc<Record<string, unknown>>("Actor", actorId) ?? null;
    };
    ler();
    return worldMirror.subscribe("Actor", ler);
  });
  const imgAtual = $derived(typeof atorVivo?.["img"] === "string" ? (atorVivo["img"] as string) : null);
  const imagemAnterior = $derived(readImagemAnterior(atorVivo));

  /** A rendered figure waiting for the player's OK before it replaces art of their own. */
  let pendente: { modo: ModoMiniatura; png: Blob; url: string } | null = $state(null);

  function descartarPendente(): void {
    if (pendente !== null) URL.revokeObjectURL(pendente.url);
    pendente = null;
  }

  $effect(() => () => descartarPendente());

  async function usarComo(modo: ModoMiniatura): Promise<void> {
    if (!podeEditar || catalogo === null) return;
    descartarPendente();
    // The token is made from the avatar: the avatar on the document must be the
    // same figure, so the pending edit lands first.
    await fila.descarregar();
    salvando = true;
    mensagem = null;
    try {
      const png = await renderizarMiniatura(catalogo, selecao, corpo, modo);
      if (png === null) {
        mensagem = t("FUSION.Avatar.Error.Empty");
        return;
      }
      // Art the player brought from elsewhere is not replaced without an OK —
      // and nothing is uploaded until then.
      if (precisaConfirmarSubstituicao(imgAtual)) {
        pendente = { modo, png, url: URL.createObjectURL(png) };
        return;
      }
      await aplicarArte(modo, png);
    } catch {
      mensagem = t("FUSION.Avatar.Error.Art");
    } finally {
      salvando = false;
    }
  }

  async function confirmarSubstituicao(): Promise<void> {
    const alvo = pendente;
    if (alvo === null) return;
    salvando = true;
    mensagem = null;
    try {
      await aplicarArte(alvo.modo, alvo.png);
    } catch {
      mensagem = t("FUSION.Avatar.Error.Art");
    } finally {
      descartarPendente();
      salvando = false;
    }
  }

  /** Upload, check the path, write `img`. Throws (leaving `img` untouched) on any doubt. */
  async function aplicarArte(modo: ModoMiniatura, png: Blob): Promise<void> {
    const socket = getSocket();
    if (socket === null) {
      mensagem = t("FUSION.Avatar.Error.Offline");
      return;
    }
    const caminho = await publicarMiniatura(png, modo);
    if (!caminhoDeArteValido(caminho)) throw new Error(`invalid art path: ${caminho}`);
    // The server remembers the image this replaces (flags.fusion.imagemAnterior).
    await atualizarAtor(socket, actorId, { img: caminho });
    mensagem = t(modo === "token" ? "FUSION.Avatar.UsedAsToken" : "FUSION.Avatar.UsedAsPortrait");
  }

  async function restaurarImagem(): Promise<void> {
    const anterior = imagemAnterior;
    if (!podeEditar || !podeRestaurar(imgAtual, anterior)) return;
    const socket = getSocket();
    if (socket === null) {
      mensagem = t("FUSION.Avatar.Error.Offline");
      return;
    }
    salvando = true;
    mensagem = null;
    try {
      await atualizarAtor(socket, actorId, { img: anterior });
      mensagem = t("FUSION.Avatar.Restored");
    } catch {
      mensagem = t("FUSION.Avatar.Error.Art");
    } finally {
      salvando = false;
    }
  }

  function alternarCreditos(): void {
    mostrarCreditos = !mostrarCreditos;
    if (mostrarCreditos && creditos === null) {
      void carregarCreditos()
        .then((c) => {
          creditos = c;
        })
        .catch(() => {
          creditos = null;
        });
    }
  }

  /** Credits fields, typed loosely because they come from the acervo's build. */
  const creditoTexto = $derived.by(() => {
    if (creditos === null) return null;
    const autores = Array.isArray(creditos["autores"]) ? (creditos["autores"] as string[]) : [];
    const licencas =
      typeof creditos["licencas"] === "object" && creditos["licencas"] !== null
        ? Object.keys(creditos["licencas"] as Record<string, unknown>)
        : [];
    return {
      fonte: String(creditos["fonte"] ?? ""),
      url: String(creditos["url"] ?? ""),
      pin: String(creditos["pin"] ?? ""),
      autores,
      licencas,
    };
  });
</script>

<div class="avatar-criador" role="document" aria-label={t("FUSION.Avatar.Title", { name: nome })}>
  {#if erro !== null}
    <p class="avatar-criador__erro" role="alert">{erro}</p>
  {:else if catalogo === null}
    <p class="avatar-criador__carregando" role="status">{t("FUSION.Avatar.Loading")}</p>
  {:else}
    <!-- ---- Left column: preview, body, animation, equipped, actions ---- -->
    <div class="palco">
      <div class="palco__boneco">
        <AvatarSprite
          {catalogo}
          {selecao}
          {corpo}
          {animacao}
          zoom={4}
          rotulo={t("FUSION.Avatar.PreviewAlt", { name: nome })}
        />
      </div>

      <div class="palco__meio">
        <div class="grupo">
          <span class="grupo__rotulo">{t("FUSION.Avatar.Body")}</span>
          <div class="chips">
            {#each catalogo.recorte.corpos as variante (variante)}
              <button
                type="button"
                class="chip"
                aria-pressed={variante === corpo}
                disabled={!podeEditar}
                onclick={() => trocarCorpo(variante)}
              >{rotuloDoCorpo(catalogo, variante)}</button>
            {/each}
          </div>
        </div>

        <div class="grupo">
          <span class="grupo__rotulo">{t("FUSION.Avatar.Animation")}</span>
          <div class="chips">
            {#each catalogo.recorte.animacoes as nomeAnim (nomeAnim)}
              <button
                type="button"
                class="chip"
                aria-pressed={nomeAnim === animacao}
                onclick={() => { animacao = nomeAnim; }}
              >{rotuloDaAnimacao(nomeAnim)}</button>
            {/each}
          </div>
        </div>

        <div class="grupo">
          <span class="grupo__rotulo">{t("FUSION.Avatar.Equipped")} ({equipados.length})</span>
          <ul class="equipados">
            {#each equipados as linha (linha.slot)}
              <li>
                <span class="equipados__peca">{rotuloDoItem(linha.item!)}</span>
                <span class="equipados__slot">{linha.rotulo}</span>
                {#if podeEditar}
                  <button
                    type="button"
                    class="equipados__tirar"
                    onclick={() => tirar(linha.slot)}
                    aria-label={t("FUSION.Avatar.Unequip", { slot: linha.rotulo })}
                  >×</button>
                {/if}
              </li>
            {/each}
          </ul>
        </div>

        {#if descartados.length > 0}
          <p class="aviso" role="status">
            {t("FUSION.Avatar.Dropped", { list: descartados.join(", ") })}
          </p>
        {/if}

        <details class="na-tela">
          <summary>{t("FUSION.Avatar.Overlay.Title")}</summary>
          <AvatarOverlayControles />
        </details>

        <button type="button" class="creditos__botao" onclick={alternarCreditos} aria-expanded={mostrarCreditos}>
          {t("FUSION.Avatar.Credits")}
        </button>
        {#if mostrarCreditos}
          <div class="creditos">
            {#if creditoTexto === null}
              <p>{t("FUSION.Avatar.Loading")}</p>
            {:else}
              <p>{creditoTexto.fonte}</p>
              <p class="creditos__pin">pin {creditoTexto.pin.slice(0, 8)}</p>
              <p class="creditos__licencas">{creditoTexto.licencas.join(" · ")}</p>
              <p class="creditos__autores">{creditoTexto.autores.join(", ")}</p>
              {#if creditoTexto.url !== ""}
                <a href={creditoTexto.url} target="_blank" rel="noreferrer noopener">{creditoTexto.url}</a>
              {/if}
            {/if}
          </div>
        {/if}
      </div>

      <div class="palco__rodape">
        {#if pendente !== null}
          <div class="substituir" role="alertdialog" aria-labelledby="avatar-substituir-titulo">
            <p id="avatar-substituir-titulo" class="substituir__titulo">{t("FUSION.Avatar.ReplaceTitle")}</p>
            <div class="substituir__lados">
              <figure>
                <ActorPortrait img={imgAtual} docRef={{ table: "actors", id: actorId }} name={nome} size={64} />
                <figcaption>{t("FUSION.Avatar.ReplaceCurrent")}</figcaption>
              </figure>
              <span aria-hidden="true">→</span>
              <figure>
                <img class="substituir__nova" src={pendente.url} width="64" height="64" alt="" />
                <figcaption>{t("FUSION.Avatar.ReplaceNew")}</figcaption>
              </figure>
            </div>
            <p class="substituir__dica">{t("FUSION.Avatar.ReplaceHint")}</p>
            <div class="substituir__botoes">
              <button type="button" class="substituir__sim" disabled={salvando} onclick={confirmarSubstituicao}>
                {t("FUSION.Avatar.ReplaceConfirm")}
              </button>
              <button type="button" disabled={salvando} onclick={descartarPendente}>
                {t("FUSION.Avatar.ReplaceCancel")}
              </button>
            </div>
          </div>
        {/if}

        {#if mensagem !== null}
          <p class="mensagem" role="status">{mensagem}</p>
        {/if}

        {#if podeEditar}
          <div class="acoes">
            <button
              type="button"
              class="acoes__salvar"
              disabled={salvando || !sujo}
              title={t("FUSION.Avatar.AutoSaveHint")}
              onclick={salvar}
            >
              {salvando ? t("FUSION.Avatar.Saving") : sujo ? t("FUSION.Avatar.Save") : t("FUSION.Avatar.SavedState")}
            </button>
            <button type="button" disabled={salvando} onclick={recomecar}>{t("FUSION.Avatar.Reset")}</button>
            <button
              type="button"
              class="acoes__usar"
              disabled={salvando}
              title={t("FUSION.Avatar.UseAsTokenHint")}
              onclick={() => usarComo("token")}
            >
              {t("FUSION.Avatar.UseAsToken")}
            </button>
            <button
              type="button"
              class="acoes__usar"
              disabled={salvando}
              title={t("FUSION.Avatar.UseAsPortraitHint")}
              onclick={() => usarComo("retrato")}
            >
              {t("FUSION.Avatar.UseAsPortrait")}
            </button>
            {#if podeRestaurar(imgAtual, imagemAnterior)}
              <button
                type="button"
                class="acoes__usar acoes__largo"
                disabled={salvando}
                title={t("FUSION.Avatar.RestorePreviousHint")}
                onclick={restaurarImagem}
              >
                {t("FUSION.Avatar.RestorePrevious")}
              </button>
            {/if}
            <button type="button" class="acoes__remover" disabled={salvando || baseline === null} onclick={remover}>
              {t("FUSION.Avatar.Remove")}
            </button>
          </div>
        {/if}

      </div>
    </div>

    <!-- ---- Right column: tabs, slots, grid, colours ---- -->
    <div class="acervo">
      <div class="abas" role="tablist" aria-label={t("FUSION.Avatar.Groups")}>
        {#each abas as umaAba (umaAba.grupo)}
          <button
            type="button"
            role="tab"
            class="chip"
            aria-selected={umaAba.grupo === grupoAtivo}
            onclick={() => {
              grupoAtivo = umaAba.grupo;
              slotAtivo = umaAba.slots[0]?.slot ?? "";
              busca = "";
            }}
          >{umaAba.grupo} <span class="chip__contador">{umaAba.total}</span></button>
        {/each}
      </div>

      <div class="slots">
        {#each slots as s (s.slot)}
          <button
            type="button"
            class="chip chip--pequeno"
            aria-pressed={s.slot === slotAtivo}
            onclick={() => { slotAtivo = s.slot; busca = ""; }}
          >
            {s.rotulo} <span class="chip__contador">{s.itens.length}</span>
            {#if selecao[s.slot] !== undefined}<span class="chip__marca" aria-hidden="true">●</span>{/if}
          </button>
        {/each}
      </div>

      {#if canais.length > 0}
        <div class="cores">
          {#each canais as canal (canal.nome)}
            <div class="cores__canal">
              <span class="cores__rotulo">{canal.rotulo}</span>
              <div class="cores__lista">
                {#each canal.opcoes as opcao (opcao.valor)}
                  <button
                    type="button"
                    class="cor"
                    class:cor--faixa={opcao.tipo === "faixa"}
                    style={opcao.amostra === null ? undefined : `background:${opcao.amostra}`}
                    aria-pressed={corSelecionada(selecao, slotAtivo, canal) === opcao.valor}
                    disabled={!podeEditar}
                    title={opcao.rotulo}
                    aria-label={opcao.rotulo}
                    onclick={() => pintar(canal, opcao.valor)}
                  >{opcao.amostra === null ? opcao.rotulo.slice(0, 2) : ""}</button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if (slotAtual?.itens.length ?? 0) > 12}
        <input
          class="busca"
          type="search"
          placeholder={t("FUSION.Avatar.Search")}
          bind:value={busca}
          aria-label={t("FUSION.Avatar.Search")}
        />
      {/if}

      <div class="grade">
        <!-- "none": the character WITHOUT anything in this slot -->
        <button
          type="button"
          class="cel"
          aria-pressed={slotAtual !== undefined && selecao[slotAtual.slot] === undefined}
          disabled={!podeEditar}
          onclick={() => escolher(null)}
        >
          <AvatarSprite {catalogo} selecao={selecaoCom(null)} {corpo} {animacao} zoom={2} animando={false} />
          <span class="cel__nome">{t("FUSION.Avatar.None")}</span>
        </button>

        {#each itensVisiveis as item (item.id)}
          <button
            type="button"
            class="cel"
            class:cel--sem-arte={semArteNoCorpo(item, corpo)}
            aria-pressed={slotAtual !== undefined && selecao[slotAtual.slot]?.id === item.id}
            disabled={!podeEditar || semArteNoCorpo(item, corpo)}
            title={semArteNoCorpo(item, corpo)
              ? t("FUSION.Avatar.NoArt", { body: rotuloDoCorpo(catalogo, corpo) })
              : rotuloDoItem(item)}
            onclick={() => escolher(item)}
          >
            <AvatarSprite {catalogo} selecao={selecaoCom(item)} {corpo} {animacao} zoom={2} animando={false} />
            <span class="cel__nome">{rotuloDoItem(item)}</span>
          </button>
        {/each}

        {#if itensVisiveis.length === 0}
          <p class="grade__vazia">{t("FUSION.Avatar.NoMatch")}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .avatar-criador {
    display: flex;
    gap: 0;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .avatar-criador__erro,
  .avatar-criador__carregando {
    color: var(--fusion-text-subtle);
    margin: auto;
    padding: 2rem;
  }

  .avatar-criador__erro {
    color: var(--fusion-danger);
  }

  /* ---- left column ---- */

  /* Three bands: the preview and the actions never scroll away — only the
     middle (body, animation, equipped list, settings) does. Before, the column
     scrolled as a whole: with a dressed figure the preview left the screen and
     five wrapping action buttons covered the animation chips in a short window. */
  .palco {
    border-right: 1px solid var(--fusion-border);
    container-type: size;
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
    padding: 0.75rem 0.75rem 0.5rem;
    width: 244px;
  }

  .palco__meio {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
    overflow-y: auto;
  }

  .palco__rodape {
    border-top: 1px solid var(--fusion-border);
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 0.4rem;
    padding-top: 0.5rem;
  }

  /* The preview shrinks with the window instead of pushing everything out. */
  .palco__boneco :global(canvas) {
    height: clamp(96px, 34cqh, 256px);
    width: auto;
  }

  .palco__boneco {
    align-items: center;
    background:
      linear-gradient(45deg, rgba(255, 255, 255, 0.04) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.04) 75%),
      linear-gradient(45deg, rgba(255, 255, 255, 0.04) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.04) 75%);
    background-position: 0 0, 8px 8px;
    background-size: 16px 16px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    display: flex;
    justify-content: center;
    padding: 0.5rem;
  }

  .grupo {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .grupo__rotulo {
    color: var(--fusion-text-subtle);
    font-size: 0.6875rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .chips,
  .abas,
  .slots {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .chip {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-pill);
    color: var(--fusion-text);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0.2rem 0.55rem;
  }

  .chip--pequeno {
    font-size: 0.6875rem;
  }

  .chip:hover:not(:disabled) {
    border-color: var(--fusion-accent);
  }

  .chip[aria-pressed="true"],
  .chip[aria-selected="true"] {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-on-accent);
    font-weight: 600;
  }

  .chip:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .chip__contador {
    opacity: 0.6;
    font-size: 0.625rem;
  }

  .chip__marca {
    color: var(--fusion-success);
    font-size: 0.5rem;
    vertical-align: middle;
  }

  .chip[aria-pressed="true"] .chip__marca {
    color: var(--fusion-on-accent);
  }

  .equipados {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .equipados li {
    align-items: baseline;
    border-bottom: 1px dotted var(--fusion-border);
    display: flex;
    font-size: 0.6875rem;
    gap: 0.35rem;
    padding: 0.1rem 0;
  }

  .equipados__peca {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .equipados__slot {
    color: var(--fusion-text-subtle);
  }

  .equipados__tirar {
    background: none;
    border: 0;
    color: var(--fusion-text-subtle);
    cursor: pointer;
    line-height: 1;
    padding: 0 0.15rem;
  }

  .equipados__tirar:hover {
    color: var(--fusion-danger);
  }

  .aviso,
  .mensagem {
    color: var(--fusion-text-subtle);
    font-size: 0.6875rem;
    margin: 0;
  }

  .acoes {
    display: grid;
    gap: 0.3rem;
    grid-template-columns: 1fr 1fr;
  }

  .acoes__largo {
    grid-column: 1 / -1;
  }

  .acoes button {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    font-size: 0.6875rem;
    line-height: 1.2;
    overflow: hidden;
    padding: 0.3rem 0.4rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .acoes button:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .acoes__salvar:not(:disabled) {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-on-accent);
    font-weight: 600;
  }

  .acoes__remover:not(:disabled):hover {
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .substituir {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem;
  }

  .substituir__titulo {
    font-size: 0.75rem;
    font-weight: 600;
    margin: 0;
  }

  .substituir__lados {
    align-items: center;
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }

  .substituir__lados figure {
    align-items: center;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0;
  }

  .substituir__lados figcaption,
  .substituir__dica {
    color: var(--fusion-text-subtle);
    font-size: 0.625rem;
    margin: 0;
  }

  .substituir__nova {
    image-rendering: pixelated;
  }

  .substituir__botoes {
    display: flex;
    gap: 0.35rem;
  }

  .substituir__botoes button {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0.3rem 0.6rem;
  }

  .substituir__botoes .substituir__sim {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-on-accent);
    font-weight: 600;
  }

  .na-tela summary {
    color: var(--fusion-text-subtle);
    cursor: pointer;
    font-size: 0.6875rem;
    letter-spacing: 0.06em;
    margin-bottom: 0.35rem;
    text-transform: uppercase;
  }

  .creditos__botao {
    align-self: flex-start;
    background: none;
    border: 0;
    color: var(--fusion-text-subtle);
    cursor: pointer;
    font-size: 0.625rem;
    padding: 0;
    text-decoration: underline;
  }

  .creditos {
    color: var(--fusion-text-subtle);
    font-size: 0.5625rem;
    line-height: 1.4;
  }

  .creditos p {
    margin: 0 0 0.2rem;
  }

  .creditos__autores {
    max-height: 6rem;
    overflow-y: auto;
  }

  /* ---- right column ---- */

  .acervo {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .abas {
    border-bottom: 1px solid var(--fusion-border);
    padding: 0.5rem 0.6rem;
  }

  .slots {
    border-bottom: 1px solid var(--fusion-border);
    padding: 0.4rem 0.6rem;
  }

  .cores {
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.4rem 0.6rem;
  }

  .cores__canal {
    align-items: center;
    display: flex;
    gap: 0.4rem;
  }

  .cores__rotulo {
    color: var(--fusion-text-subtle);
    flex: none;
    font-size: 0.625rem;
    width: 6rem;
  }

  .cores__lista {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
  }

  .cor {
    background: var(--fusion-surface-alt);
    border: 2px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-subtle);
    cursor: pointer;
    font-size: 0.5rem;
    height: 20px;
    overflow: hidden;
    padding: 0;
    width: 20px;
  }

  /* Atlas bands are pre-painted art, palette ramps are recoloured at draw time:
     the ring tells the player they are two different kinds of choice. */
  .cor--faixa {
    border-radius: 50%;
  }

  .cor[aria-pressed="true"] {
    border-color: var(--fusion-accent);
  }

  .cor:disabled {
    cursor: default;
  }

  .busca {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-size: 0.75rem;
    margin: 0.4rem 0.6rem 0;
    padding: 0.25rem 0.4rem;
  }

  .grade {
    display: grid;
    flex: 1;
    gap: 0.4rem;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    overflow-y: auto;
    padding: 0.5rem 0.6rem 1.5rem;
  }

  .cel {
    align-items: center;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.25rem;
  }

  .cel:hover:not(:disabled) {
    border-color: var(--fusion-accent);
  }

  .cel[aria-pressed="true"] {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
  }

  .cel--sem-arte {
    cursor: not-allowed;
    opacity: 0.35;
  }

  .cel__nome {
    color: var(--fusion-text-subtle);
    font-size: 0.5625rem;
    line-height: 1.15;
    max-width: 100%;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grade__vazia {
    color: var(--fusion-text-subtle);
    font-size: 0.75rem;
    grid-column: 1 / -1;
  }
</style>
