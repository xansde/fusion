import { test, chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// Roteiro BHR-F3-11: o L2 do Bhrotto (motor, alvo e Presa) no app de verdade (06/10/2026).
//
// Nao sobe servidor (como o bhrotto-l1): conecta a um servidor isolado ja provisionado, com data-dir proprio (nunca o
// mundo real), a cena "Clareira do Ogro" no ar, o Bhrotto nivel 3 (token + ficha) e um "Ogro" NPC (nivel 3, Grande)
// num combate em andamento. Nao muda codigo de produto e nao conserta nada: divergencia vira linha da tabela
// esperado x tela e achado no relatorio.
//
// "Critico forcado": o servidor nao tem seed nem gancho de teste (o RollService aceita `rng` so por injecao em codigo de
// teste). O servidor de print sobe com `node --import rng-force.mjs`, um preload FORA do repo que, enquanto o arquivo
// BHR_RNG_FLAG existe, devolve o uint32 do arquivo ao CSPRNG do roll-service. d20 = valor % 20 + 1 para valores abaixo de
// 4294967280: "ffffffef" = 20 natural, "ffffffec" = 17. O arquivo e criado so ao redor de UM clique.
//
// Variaveis: BHR_BASE_URL (obrigatoria), BHR_RNG_FLAG (obrigatoria), BHR_REPO_ROOT (worktree do core), BHR_OUT (saida;
// default .fusion-build/bhrotto/L2), BHR_FRESH=1 (apaga a saida antes). Navegador: Edge (Chrome e proibido).
// IMPORTANTE: rode UMA vez por servidor recem-iniciado. O servidor guarda a mira do usuario na memoria e o cliente que
// reconecta nao a recebe de volta (ver defeito D-mira-reconexao no relatorio).

const BASE = process.env["BHR_BASE_URL"] ?? "";
const FLAG = process.env["BHR_RNG_FLAG"] ?? "";
const REPO = process.env["BHR_REPO_ROOT"] ?? "C:/Users/xansd/pessoal/fusion/.claude/worktrees/bhr-bhr-f3-11";
const OUT = path.resolve(process.env["BHR_OUT"] ?? "C:/Users/xansd/pessoal/fusion/.fusion-build/bhrotto/L2");
const PLAYER = "Bhrotto";
const NAT20 = "ffffffef";
const D17 = "ffffffec";
// Posicao do token do Ogro na viewport 1440x1300 com a cena 1400x900 (o jogador ve o token anonimo "?" de 1 casa).
const OGRO_JOGADOR = { x: 583, y: 495 };
const OGRO_MESTRE = { x: 617, y: 530 };

interface PassoManifest {
  n: number;
  fase: string;
  arquivo: string;
  titulo: string;
  nota: string | null;
  alvo: string | null;
  pagina: string;
}
interface Linha {
  fase: string;
  campo: string;
  esperado: string;
  tela: string;
  ok: boolean;
  nota?: string;
}
const manifest = {
  roteiro: "bhrotto-l2",
  geradoEm: new Date().toISOString(),
  passos: [] as PassoManifest[],
  falhas: [] as { secao: string; passo: number; mensagem: string }[],
};
const linhas: Linha[] = [];
const achados: { id: string; texto: string }[] = [];
const lidos: Record<string, unknown> = {};

let browser: Browser;
let gmCtx: BrowserContext;
let plCtx: BrowserContext;
let gm: Page;
let pl: Page;
let faseAtual = "00-conferencia";

function grava(): void {
  writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

async function passo(titulo: string, alvo: Locator | null, nota: string | undefined, pagina: "gm" | "pl" = "pl"): Promise<void> {
  const win = pagina === "gm" ? gm : pl;
  const n = manifest.passos.length + 1;
  const dir = path.join(OUT, faseAtual);
  mkdirSync(dir, { recursive: true });
  const arquivo = `${faseAtual}/${String(n).padStart(2, "0")}-${pagina === "gm" ? "mestre" : "jogador"}.png`;
  let descricao: string | null = null;
  if (alvo !== null) {
    const box = await alvo.first().boundingBox({ timeout: 8_000 });
    if (box === null) throw new Error(`passo ${String(n)} ("${titulo}"): alvo fora da tela (${pagina})`);
    const texto = ((await alvo.first().innerText({ timeout: 3_000 }).catch(() => "")) ?? "").trim().split("\n")[0] ?? "";
    descricao = texto.length === 0 ? null : texto.slice(0, 72);
    await win.evaluate(({ x, y, width, height }) => {
      const ring = document.createElement("div");
      ring.id = "__e2e_ring__";
      Object.assign(ring.style, {
        position: "fixed", left: `${String(x - 8)}px`, top: `${String(y - 8)}px`,
        width: `${String(width + 16)}px`, height: `${String(height + 16)}px`,
        border: "3px solid #f0684c", borderRadius: "10px",
        boxShadow: "0 0 0 4px rgba(240,104,76,0.22), 0 0 22px rgba(240,104,76,0.5)",
        pointerEvents: "none", zIndex: "9999",
      });
      document.body.appendChild(ring);
    }, box);
  }
  await win.screenshot({ path: path.join(OUT, arquivo) });
  await win.evaluate(() => document.getElementById("__e2e_ring__")?.remove());
  manifest.passos.push({ n, fase: faseAtual, arquivo, titulo, nota: nota ?? null, alvo: descricao, pagina });
  grava();
}

async function secao(nome: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const msg = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    manifest.falhas.push({ secao: nome, passo: manifest.passos.length, mensagem: msg.slice(0, 1500) });
    grava();
    for (const p of [pl, gm]) {
      for (let i = 0; i < 3; i++) {
        if ((await p.getByRole("dialog").count().catch(() => 0)) === 0) break;
        await p.keyboard.press("Escape").catch(() => undefined);
        await p.waitForTimeout(250);
      }
    }
  }
}

function linha(campo: string, esperado: string, tela: string, nota?: string): void {
  const l: Linha = { fase: faseAtual, campo, esperado, tela, ok: esperado === tela };
  if (nota !== undefined) l.nota = nota;
  linhas.push(l);
}
function achado(id: string, texto: string): void {
  achados.push({ id, texto });
}

const NL = String.fromCharCode(10);
const txt = async (loc: Locator): Promise<string> =>
  ((await loc.first().innerText({ timeout: 8_000 })) ?? "").split(NL).map((s) => s.trim()).filter((s) => s !== "").join(" | ");

async function entrar(ctx: BrowserContext, nome: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const opcao = page.getByRole("option", { name: nome });
  await opcao.waitFor({ timeout: 20_000 });
  await opcao.click();
  await page.getByRole("button", { name: "Entrar no World" }).click();
  await page.locator('[data-tab-id="chat"]').waitFor({ timeout: 20_000 });
  return page;
}

async function abrirAba(page: Page, tabId: string): Promise<void> {
  const botao = page.locator(`[data-tab-id="${tabId}"]`);
  if ((await botao.getAttribute("aria-pressed")) !== "true") {
    await botao.click();
    await page.locator(`.sidebar-drawer[data-active-tab="${tabId}"]`).waitFor({ timeout: 10_000 });
  }
}

async function abrirFicha(p: Page, quem: string): Promise<void> {
  if ((await p.locator(".sheet-header").count()) > 0) return;
  await abrirAba(p, "contacts");
  await p.waitForTimeout(2_500);
  const abrir = p.getByRole("button", { name: new RegExp(`Abrir a ficha de ${quem}`) });
  await abrir.waitFor({ timeout: 15_000 });
  await abrir.click();
  await p.locator(".sheet-header").first().waitFor({ timeout: 45_000 });
  await p.waitForTimeout(1_000);
  const ocultar = p.getByRole("button", { name: "Ocultar plano" });
  if (await ocultar.isVisible().catch(() => false)) await ocultar.click();
  const janela = await p.locator(".fusion-window").first().boundingBox({ timeout: 5_000 });
  const box = await p.locator(".fusion-window__resize--se").first().boundingBox({ timeout: 5_000 });
  if (box !== null && janela !== null && janela.width < 900) {
    const dy = Math.max(0, Math.min(520, 1290 - (janela.y + janela.height)));
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + 250, box.y + dy, { steps: 8 });
    await p.mouse.up();
    await p.waitForTimeout(600);
  }
}

async function fecharFicha(p: Page): Promise<void> {
  await p.getByRole("button", { name: "Fechar janela" }).first().click({ timeout: 8_000 });
  await p.locator(".sheet-header").first().waitFor({ state: "detached", timeout: 8_000 }).catch(() => undefined);
  await p.waitForTimeout(500);
}

async function aba(p: Page, id: "main" | "skills" | "actions" | "spells" | "inventory" | "bio"): Promise<void> {
  await p.locator(`#tab-${id}`).click({ timeout: 8_000 });
  await p.waitForTimeout(1_100);
}

/** Cria o arquivo-flag do RNG ao redor de UMA acao e o remove em seguida (o servidor rola no mesmo instante). */
async function comRng(valorHex: string, acao: () => Promise<void>): Promise<void> {
  writeFileSync(FLAG, valorHex, "utf8");
  try {
    await acao();
    await pl.waitForTimeout(2_500);
  } finally {
    rmSync(FLAG, { force: true });
  }
}

const COR_SELO: [number, number, number] = [0xf2, 0xc2, 0x30];
const CLIP_SELO_J = { x: OGRO_JOGADOR.x - 40, y: OGRO_JOGADOR.y - 50, width: 90, height: 90 };
const CLIP_SELO_M = { x: OGRO_MESTRE.x - 80, y: OGRO_MESTRE.y - 80, width: 130, height: 110 };

/** Conta os pixels do PNG proximos da cor (tolerancia por canal); null se o decodificador nao estiver disponivel. */
function pixelsCor(png: Buffer, rgb: [number, number, number], tol: number): number | null {
  try {
    const req = createRequire(path.join("C:/Users/xansd/pessoal/fusion/.claude/skills/tutorial-e2e", "package.json"));
    const { PNG } = req("playwright-core/lib/utilsBundle") as { PNG: { sync: { read: (b: Buffer) => { width: number; height: number; data: Buffer } } } };
    const img = PNG.sync.read(png);
    let n = 0;
    for (let i = 0; i < img.width * img.height; i++) {
      const o = i * 4;
      if (Math.abs((img.data[o] ?? 0) - rgb[0]) <= tol && Math.abs((img.data[o + 1] ?? 0) - rgb[1]) <= tol && Math.abs((img.data[o + 2] ?? 0) - rgb[2]) <= tol) n += 1;
    }
    return n;
  } catch {
    return null;
  }
}

const git = (...args: string[]): string => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" }).trim();
const gitOk = (...args: string[]): boolean => {
  try {
    execFileSync("git", ["-C", REPO, ...args], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** Bloco "Efeitos ativos" da ficha aberta. */
const efeitos = (p: Page): Locator => p.getByText("Efeitos ativos", { exact: true }).first().locator("xpath=..");

/** Texto do chat do Mestre (ele ve a rolagem cega). */
const chatGm = async (): Promise<string> => {
  await abrirAba(gm, "chat");
  await gm.waitForTimeout(700);
  return txt(gm.locator(".sidebar-drawer"));
};
const chatPl = async (): Promise<string> => {
  await abrirAba(pl, "chat");
  await pl.waitForTimeout(700);
  return txt(pl.locator(".sidebar-drawer"));
};

const golpe = (): Locator => pl.locator("li.strike-row", { hasText: "Mangual de Guerra" });
const faixa = (): Locator => pl.locator('[data-testid="combat-states-strip"]');

test.beforeAll(async () => {
  if (BASE === "" || FLAG === "") throw new Error("defina BHR_BASE_URL e BHR_RNG_FLAG (servidor isolado ja provisionado)");
  if (process.env["BHR_FRESH"] === "1") rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  rmSync(FLAG, { force: true });
  // Edge, nunca Chrome (regra global no-chrome-extension)
  browser = await chromium.launch({ channel: "msedge", headless: process.env["FUSION_E2E_HEADED"] !== "1" });
  const viewport = { width: 1440, height: 1300 };
  gmCtx = await browser.newContext({ viewport });
  plCtx = await browser.newContext({ viewport });
  pl = await entrar(plCtx, PLAYER);
  gm = await entrar(gmCtx, "Gamemaster");
  gm.setDefaultTimeout(15_000);
  pl.setDefaultTimeout(15_000);
  await pl.waitForTimeout(2_500);
});

test.afterAll(async () => {
  rmSync(FLAG, { force: true });
  writeFileSync(path.join(OUT, "tabela.json"), JSON.stringify(linhas, null, 1), "utf8");
  writeFileSync(path.join(OUT, "achados.json"), JSON.stringify(achados, null, 1), "utf8");
  writeFileSync(path.join(OUT, "lidos.json"), JSON.stringify(lidos, null, 1), "utf8");
  const dv = linhas.filter((l) => !l.ok);
  console.log(`BHR-F3-11: ${String(manifest.passos.length)} prints, ${String(linhas.length)} linhas, ${String(dv.length)} divergencias, ${String(manifest.falhas.length)} secoes com falha`);
  await browser.close();
});

test("0. Conferencia da branch", async () => {
  faseAtual = "00-conferencia";
  const head = git("rev-parse", "HEAD");
  lidos["branch"] = { head, branch: git("branch", "--show-current"), satelite: git("-C", "external/fusion-systems-2e", "rev-parse", "HEAD") };
  const base = "f23ad2644a6ecb8e8f1dbeea0cbd2bf2a1ea1c0f";
  const baseCompleta = git("rev-parse", "f23ad264");
  linha(`merge-base --is-ancestor f23ad264 HEAD (base = origin/feat/bhrotto, ondas 1-7)`, "true", String(gitOk("merge-base", "--is-ancestor", baseCompleta, "HEAD")));
  linha("merge-base --is-ancestor origin/feat/bhrotto HEAD", "true", String(gitOk("merge-base", "--is-ancestor", "origin/feat/bhrotto", "HEAD")));
  void base;
});

test("1. Mira no canvas: botao direito no ogro (T4)", async () => {
  test.setTimeout(240_000);
  faseAtual = "01-mira";
  await secao("1. Mira", async () => {
    await passo("Jogador: o mapa antes de mirar (o ogro aparece como token anonimo '?')", null, "Cena Clareira do Ogro: o Bhrotto e um token anonimo do Mestre, de 1 casa para o jogador.");
    await passo("Mestre: o mesmo mapa antes de mirar (o ogro e Grande e tem nome)", null, "O Mestre ve o Ogro com 2x2 casas e o nome.", "gm");
    await pl.mouse.click(OGRO_JOGADOR.x, OGRO_JOGADOR.y, { button: "right" });
    await pl.waitForTimeout(1_500);
    lidos["selo-baseline"] = {
      jogador: pixelsCor(await pl.screenshot({ clip: CLIP_SELO_J }), COR_SELO, 14),
      mestre: pixelsCor(await gm.screenshot({ clip: CLIP_SELO_M }), COR_SELO, 14),
    };
    await passo("Jogador: botao direito no ogro mira o token", null, "A retícula de cantos vermelhos aparece no token que o jogador mirou.");
    await passo("Mestre: a mira do jogador no ogro", null, "A retícula do Mestre tambem aparece no ogro (a mira e do usuario, mas todos veem).", "gm");
  });
});

test("2. Ficha: Acoes com o alvo mirado (T3)", async () => {
  test.setTimeout(240_000);
  faseAtual = "02-acoes";
  await secao("2. Acoes", async () => {
    await abrirFicha(pl, PLAYER);
    await aba(pl, "actions");
    await abrirAba(pl, "chat");
    const linhaCacar = pl.locator('[data-executable="hunt-prey"]');
    const habilitado = await linhaCacar.evaluate((e) => !(e as HTMLButtonElement).disabled);
    linha("Cacar Presa habilita com um alvo mirado", "true", String(habilitado), "sem alvo o botao diz 'Requer um alvo mirado.'");
    const g = await txt(golpe());
    lidos["golpe-antes"] = g;
    linha("Golpe do Mangual de Guerra: +9 e MAP 0 antes do primeiro ataque", "+9 | MAP 0", /\+9 \| MAP 0/.test(g) ? "+9 | MAP 0" : g);
    await passo("Jogador: aba Acoes com o golpe +9 / MAP 0 e a linha Cacar Presa", golpe(), "O botao do golpe ja sabe o MAP (BHR-F3-05). A linha 'Cacar Presa' tem a pericia do Rememorar (Natureza) e o botao Usar habilitado porque ha alvo mirado.");
    await linhaCacar.scrollIntoViewIfNeeded();
    await passo("Jogador: Cacar Presa com o alvo mirado", pl.locator(".actions-row", { has: linhaCacar }), "Natureza escolhida para o Rememorar Conhecimento do Cacador de Monstros; 'Usar' habilitado.");
  });
});

test("3. Cacar Presa com Rememorar (critico forcado) e o card (T5)", async () => {
  test.setTimeout(240_000);
  faseAtual = "03-cacar-presa";
  await secao("3. Cacar Presa", async () => {
    await comRng(NAT20, async () => {
      await pl.locator('[data-executable="hunt-prey"]').click();
    });
    await pl.waitForTimeout(1_500);
    const ef = await txt(efeitos(pl));
    lidos["efeitos-depois-cacar"] = ef;
    const cab = await txt(pl.locator(".sheet-header"));
    lidos["cabecalho-presa"] = cab;
    linha("Efeitos ativos: Presa e Cacador de Monstros (critico no Rememorar)", "Presa + Cacador de Monstros", /Presa/.test(ef) && /Caçador de Monstros/.test(ef) ? "Presa + Cacador de Monstros" : ef);
    linha("CA mostra +1 contra a presa", "+1 contra a presa", /\+1 contra a presa/.test(cab) ? "+1 contra a presa" : cab);
    await passo("Jogador: a ficha depois de Cacar Presa: CA +1 contra a presa e os efeitos ativos", pl.locator(".sheet-header"), "Cabecalho com '19 CA +1 contra a presa (Outwit)'. Efeitos ativos: Presa (ate nova Cacar Presa) e Cacador de Monstros (ate a proxima rolagem de ataque).");
    const strip = await txt(faixa());
    linha("Faixa de estados mostra Presa e Cacador de Monstros", "Presa + Cacador de Monstros", /Presa/.test(strip) && /Caçador de Monstros/.test(strip) ? "Presa + Cacador de Monstros" : strip);
    await passo("Jogador: a faixa 'Estados de combate' compacta, so nomes", faixa(), "Medicina Natural, Presa e Cacador de Monstros: so o nome de cada estado.");
    await passo("Jogador: o card 'Cacar Presa' no chat, visto pelo jogador", pl.locator(".sidebar-drawer"), "O Rememorar Conhecimento e rolagem cega (traco secret): o jogador nao ve o numero nem o grau.");
    const tPl = await chatPl();
    const tGm = await chatGm();
    lidos["chat-jogador-cacar"] = tPl;
    lidos["chat-mestre-cacar"] = tGm;
    await passo("Mestre: o mesmo card, com o Rememorar visivel", gm.locator(".sidebar-drawer"), "O Mestre ve a rolagem cega: [20] + 9 + 2 = 31, sucesso critico.", "gm");
    const ultimoGm = tGm.slice(tGm.lastIndexOf("Usa Caçar Presa"));
    const ultimoPl = tPl.slice(tPl.lastIndexOf("Usa Caçar Presa"));
    linha("Rememorar cego: o Mestre ve o resultado (nat 20 forcado, sucesso critico)", "[20] + 9 + 2 | SUCESSO CRÍTICO | 31", /\[20\] \+ 9 \+ 2 \| SUCESSO CRÍTICO \| 31/.test(ultimoGm) ? "[20] + 9 + 2 | SUCESSO CRÍTICO | 31" : ultimoGm.slice(0, 300));
    linha("Rememorar cego: o jogador NAO ve a rolagem", "sem rolagem", /SUCESSO CRÍTICO|\[20\]/.test(ultimoPl) ? "ve a rolagem" : "sem rolagem");
    linha("Card sem placeholder cru ('Efeito aplicado: {name}')", "sem {name}", /\{name\}/.test(ultimoGm) ? "tem {name}" : "sem {name}", "o card deveria nomear o efeito aplicado (Presa)");
  });
});

test("4. Mapa: a Presa marcada (T4)", async () => {
  test.setTimeout(240_000);
  faseAtual = "04-mapa-presa";
  await secao("4. Mapa", async () => {
    await fecharFicha(pl);
    await pl.waitForTimeout(800);
    // Selo da Presa: losango dourado (0xf2c230) no canto superior direito da primeira casa do token. O token tem uma
    // borda amarela parecida; por isso conta-se a DIFERENCA de pixels dourados contra a linha de base de antes da Presa.
    const base = lidos["selo-baseline"] as { jogador: number | null; mestre: number | null } | undefined;
    const aJ = pixelsCor(await pl.screenshot({ clip: CLIP_SELO_J }), COR_SELO, 14);
    const aM = pixelsCor(await gm.screenshot({ clip: CLIP_SELO_M }), COR_SELO, 14);
    lidos["selo-presa-pixels"] = { antes: base, depois: { jogador: aJ, mestre: aM } };
    const novoJ = aJ !== null && base?.jogador != null ? aJ - base.jogador : null;
    const novoM = aM !== null && base?.mestre != null ? aM - base.mestre : null;
    linha("Selo dourado de Presa no token (jogador)", "desenhado", novoJ !== null && novoJ >= 40 ? "desenhado" : "ausente", `pixels dourados novos no recorte: ${String(novoJ)}`);
    linha("Selo dourado de Presa no token (Mestre)", "desenhado", novoM !== null && novoM >= 40 ? "desenhado" : "ausente", `pixels dourados novos no recorte: ${String(novoM)}`);
    await passo("Jogador: o ogro mirado e marcado como Presa", null, "Esperado (T4): selo dourado 'PRESA' no canto do token alem da reticula de mira. O token continua anonimo '?'.");
    await passo("Mestre: o ogro mirado e marcado como Presa", null, "Esperado (T4): o mesmo selo, com tooltip 'Presa de Bhrotto'.", "gm");
  });
});

test("5. Dois ataques: MAP +9 e +4 (T3, T5)", async () => {
  test.setTimeout(300_000);
  faseAtual = "05-ataques";
  await secao("5. Ataques", async () => {
    await abrirFicha(pl, PLAYER);
    await aba(pl, "actions");
    await abrirAba(pl, "chat");
    const antes = await txt(golpe());
    await passo("Jogador: o golpe antes do primeiro ataque (MAP 0, +9)", golpe(), "A ficha afirma que 'contra a presa' os bonus ja estao no total do golpe.");
    linha("Botao do golpe antes: +9 / MAP 0", "+9 | MAP 0", /\+9 \| MAP 0/.test(antes) ? "+9 | MAP 0" : antes);
    await comRng(NAT20, async () => {
      await golpe().locator(".map-btn").first().click();
    });
    const depois1 = await txt(golpe());
    linha("Botao do golpe depois do 1o ataque: +4 / MAP -5", "+4 | MAP -5", /\+4 \| MAP -5/.test(depois1) ? "+4 | MAP -5" : depois1);
    await passo("Jogador: o golpe depois do primeiro ataque (MAP -5, +4)", golpe(), "O servidor contou o ataque; o botao passa a +4 (MAP -5).");
    const ef1 = await txt(efeitos(pl));
    lidos["efeitos-depois-ataque1"] = ef1;
    linha("Efeito Cacador de Monstros sai depois do 1o ataque", "so Presa", /Caçador de Monstros/.test(ef1) ? "ainda ativo" : "so Presa");
    const t1 = await chatGm();
    const m1 = /Mangual de Guerra \(MAP 0\)(?:.|\n)*?\[(\d+)\] \+ (\d+)(?: \+ (\d+))? \| ([A-ZÇÃÍÉ ]+) \| (\d+)/.exec(t1);
    lidos["ataque1"] = m1?.slice(0, 6) ?? t1.slice(-400);
    linha("Ataque 1 (nat 20 forcado): total = d20 + 9 + 1 do Cacador de Monstros = 30", "30", m1?.[5] ?? "?", "so o primeiro ataque contra a presa leva o +1 circunstancia (REQ-BHR-095..097)");
    await passo("Mestre: o card do primeiro ataque (MAP 0)", gm.locator(".sidebar-drawer"), "Acerto critico com UM botao de dano (Rolar dano critico). O total esperado e 30 (20 + 9 + 1).", "gm");
    await comRng(D17, async () => {
      await golpe().locator(".map-btn").first().click();
    });
    const depois2 = await txt(golpe());
    linha("Botao do golpe depois do 2o ataque: -1 / MAP -10", "-1 | MAP -10", /-1 \| MAP -10/.test(depois2) ? "-1 | MAP -10" : depois2);
    const t2 = await chatGm();
    const m2 = /Mangual de Guerra \(MAP 1\)(?:.|\n)*?\[(\d+)\] \+ (\d+) \| ([A-ZÇÃÍÉ ]+) \| (\d+)/.exec(t2);
    lidos["ataque2"] = m2?.slice(0, 5) ?? t2.slice(-400);
    linha("Ataque 2 (d20 17 forcado): [17] + 4 = 21 (MAP -5, sem o +1)", "[17] + 4 | 21", m2 ? `[${m2[1] ?? "?"}] + ${m2[2] ?? "?"} | ${m2[4] ?? "?"}` : "?");
    await passo("Mestre: o card do segundo ataque (MAP 1, +4)", gm.locator(".sidebar-drawer"), "Acerto (17 + 4 = 21 contra CA 19), sem o +1 do Cacador de Monstros (ja consumido).", "gm");
    const tp = await chatPl();
    await passo("Jogador: os dois cards de golpe no chat", pl.locator(".sidebar-drawer"), "O jogador ve os dois cards: Acerto critico e Acerto.");
    lidos["chat-jogador-ataques"] = tp.slice(-600);
  });
});

test("6. Alcance Prensil: dado d8 e alcance (T3)", async () => {
  test.setTimeout(240_000);
  faseAtual = "06-alcance-prensil";
  await secao("6. Alcance Prensil", async () => {
    await aba(pl, "actions");
    const antes = await txt(golpe());
    linha("Golpe sem o Alcance Prensil: 1d10 +4 e sem o traco alcance", "1d10 +4 sem alcance", /1d10 \+4/.test(antes) && !/alcance/.test(antes) ? "1d10 +4 sem alcance" : antes);
    await passo("Jogador: o golpe SEM o Alcance Prensil (1d10)", golpe(), "O Mangual de Guerra com o dado original.");
    await aba(pl, "main");
    const chave = pl.locator('[role=switch][aria-label="Alcance Prênsil"]');
    await chave.scrollIntoViewIfNeeded();
    await passo("Jogador: aba Principal, interruptor 'Alcance Prensil' (nome em pt-BR) desligado", chave, "O titulo do interruptor ja vem em pt-BR (corrigido na onda 6).");
    await chave.click();
    await pl.waitForTimeout(1_500);
    await passo("Jogador: o interruptor LIGADO", chave, "Ligado, a ficha soma o efeito nos golpes.");
    await aba(pl, "actions");
    const depois = await txt(golpe());
    lidos["golpe-alcance"] = depois;
    linha("Golpe com o Alcance Prensil: dado cai um passo (1d8 +4) e ganha o traco alcance", "1d8 +4 com alcance", /1d8 \+4/.test(depois) && /alcance/.test(depois) ? "1d8 +4 com alcance" : depois);
    linha("O traco mostra o valor do alcance (10 pes)", "alcance 10", /alcance 10|10 pés/.test(depois) ? "alcance 10" : "so 'alcance'", "o valor 10 nao aparece na linha do golpe");
    await passo("Jogador: o golpe COM o Alcance Prensil (1d8, traco alcance)", golpe(), "O dado cai de d10 para d8 e o golpe ganha o traco 'alcance'.");
  });
});

test("7. Faixa compacta: abrir e fechar um estado (T3)", async () => {
  test.setTimeout(240_000);
  faseAtual = "07-faixa";
  await secao("7. Faixa", async () => {
    await aba(pl, "actions");
    const fx = faixa();
    await fx.scrollIntoViewIfNeeded();
    await passo("Jogador: faixa 'Estados de combate' recolhida (so nomes)", fx, "So o nome de cada estado ativo: Medicina Natural, Alcance Prensil, Presa.");
    const chipAlc = fx.locator(".css-chip", { hasText: "Alcance Prênsil" });
    await chipAlc.click();
    await pl.waitForTimeout(500);
    const aberto = await txt(fx);
    lidos["faixa-alcance-aberto"] = aberto;
    await passo("Jogador: o estado 'Alcance Prensil' aberto na faixa", fx, "Um clique no nome revela o texto do efeito.");
    linha("Alcance Prensil aberto: o texto diz alcance 10 pes e dado um passo menor (BHR-F2-04)", "alcance 10 pés, dado um passo menor", /10 pés/.test(aberto) && /passo menor/.test(aberto) ? "alcance 10 pés, dado um passo menor" : (aberto.split("Alcance Prênsil |")[1] ?? aberto).slice(0, 80));
    await chipAlc.click();
    await pl.waitForTimeout(500);
    linha("Segundo clique recolhe o estado", "recolhido", (await chipAlc.getAttribute("aria-expanded")) === "false" ? "recolhido" : "aberto");
    await passo("Jogador: o estado recolhido de novo", fx, "O segundo clique recolhe.");
    const chipMed = fx.locator(".css-chip", { hasText: "Medicina Natural" });
    await chipMed.click();
    await pl.waitForTimeout(500);
    const med = await txt(fx);
    lidos["faixa-medicina-aberto"] = med;
    linha("Medicina Natural aberta: a ressalva de 'ambiente selvagem' (reprint do defeito do L1)", "ambiente selvagem", /ambiente selvagem/.test(med) ? "ambiente selvagem" : "ausente");
    await passo("Jogador: Medicina Natural aberta, com a ressalva de ambiente selvagem", fx, "Reprint do L1: o +2 vale so ao Tratar Ferimentos com Natureza, em ambiente selvagem, a criterio do Mestre.");
    await chipMed.click();
    const chipPresa = fx.locator(".css-chip", { hasText: /^Presa$/ });
    await chipPresa.click();
    await pl.waitForTimeout(500);
    lidos["faixa-presa-aberto"] = await txt(fx);
    await passo("Jogador: o estado 'Presa' aberto", fx, "O texto da Presa nao cita o nome do alvo (D-B18).");
    await chipPresa.click();
  });
});

test("8. Inventario com os nomes em pt-BR (reprint do L1)", async () => {
  test.setTimeout(180_000);
  faseAtual = "08-inventario";
  await secao("8. Inventario", async () => {
    await aba(pl, "inventory");
    const inv = await txt(pl.locator('[role="tabpanel"]'));
    lidos["inventario"] = inv;
    linha("Inventario: 'Mangual de Guerra'", "Mangual de Guerra", /Mangual de Guerra/.test(inv) ? "Mangual de Guerra" : /War Flail/.test(inv) ? "War Flail" : "ausente");
    linha("Inventario: 'Cota de Malha'", "Cota de Malha", /Cota de Malha/.test(inv) ? "Cota de Malha" : /Chain Mail/.test(inv) ? "Chain Mail" : "ausente");
    await passo("Jogador: o Inventario com 'Mangual de Guerra' e 'Cota de Malha'", pl.locator('[role="tabpanel"]'), "Reprint do defeito do L1 corrigido na onda 6: o nome pt-BR do snapshot do Compendio aparece no Inventario.");
  });
});

test("9. Visao do Mestre: a ficha do Bhrotto e o mapa", async () => {
  test.setTimeout(240_000);
  faseAtual = "09-mestre";
  await secao("9. Mestre", async () => {
    await abrirFicha(gm, PLAYER);
    await aba(gm, "actions");
    const fx = gm.locator('[data-testid="combat-states-strip"]');
    await fx.scrollIntoViewIfNeeded().catch(() => undefined);
    await passo("Mestre: a ficha do Bhrotto na aba Acoes (faixa de estados e golpes)", gm.locator(".sheet-header"), "O Mestre ve a mesma ficha: CA +1 contra a presa e os estados ativos.", "gm");
    lidos["mestre-cabecalho"] = await txt(gm.locator(".sheet-header"));
    await fecharFicha(gm);
    await passo("Mestre: o mapa com o ogro mirado e marcado", null, "A visao do Mestre no fim do fluxo.", "gm");
  });
});

