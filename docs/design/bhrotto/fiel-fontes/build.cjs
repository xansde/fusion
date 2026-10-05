// build.cjs — assembles prototipo-bhrotto-fiel.html from REAL DOM snapshots of the running app
// (captured with playwright-cli, see snap/*.json) + hooks for the new elements (engine.js).
// Usage: node build.cjs   (writes ../../wt-docs/docs/design/bhrotto/prototipo-bhrotto-fiel.html)
const fs = require("fs");
const path = require("path");
const { JSDOM } = require(process.env.APPDATA + "/npm/node_modules/jsdom");

const ROOT = "C:/Users/xansd/AppData/Local/Temp/claude/C--Users-xansd-pessoal-fusion/2678dcfb-a764-4fb8-8199-720fe8f9e13c/scratchpad";
const SNAP = ROOT + "/proto-real/snap/";
const OUT = ROOT + "/wt-docs/docs/design/bhrotto/prototipo-bhrotto-fiel.html";

const readSnap = (n) => JSON.parse(fs.readFileSync(SNAP + n + ".json", "utf8"));
const strip = (h) => h.replace(/<!--[\s\S]*?-->/g, "");
const parse = (n) => { const d = readSnap(n); return new JSDOM("<body>" + strip(d.html) + "</body>").window.document; };
const b64 = (f) => "data:image/png;base64," + fs.readFileSync(SNAP + f).toString("base64");

const css = readSnap("p-principal").css + " " + readSnap("gm-npc-empty").css;
const $ = (D, s) => D.querySelector(s);
const $$ = (D, s) => [...D.querySelectorAll(s)];
const hashOf = (D, sel) => { const e = $(D, sel); const m = e && e.className.match(/svelte-[a-z0-9]+/); return m ? m[0] : ""; };

// ------------------------------------------------------------------ helpers
function renameBhrotto(D) {
  const walker = D.createTreeWalker(D.body, 4);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const t = n.textContent;
    if (/^\s*Jogador\s*$/.test(t) && !n.parentElement.closest(".table-header__user")) n.textContent = t.replace("Jogador", "Bhrotto Raiz-funda");
    else if (/^Jogador \(character\)$/.test(t)) n.textContent = "Bhrotto Raiz-funda (character)";
    else if (/^\s*JO\s*$/.test(t)) n.textContent = t.replace("JO", "BR");
  }
  $$(D, "[aria-label]").forEach((e) => {
    const a = e.getAttribute("aria-label");
    if (/Jogador/.test(a) && !e.closest(".table-header__user")) e.setAttribute("aria-label", a.replace(/Jogador/g, "Bhrotto Raiz-funda"));
  });
}
function px(D) { return D; }
function setWin(D, w, h, left, top) {
  const win = $(D, ".fusion-window"); if (!win) return;
  win.setAttribute("style", `position: absolute; top: ${top}px; left: ${left}px; width: ${w}px; height: ${h}px; z-index: 120;`);
}
function canvasLayer(D, bg, ovId) {
  // the PIXI canvas cannot be snapshotted: the real screenshot of the canvas is the background, overlays sit on top.
  const host = $(D, ".canvas-host"); if (!host) return;
  host.innerHTML = `<div class="proto-canvas" data-fn="${bg}" style="position:absolute;left:0;top:48px;right:0;bottom:0;overflow:hidden;background:#0e0e12"></div>` + (ovId ? `<div class="proto-ov" data-fn="${ovId}" style="position:absolute;left:0;top:48px;width:1200px;height:902px;pointer-events:none"></div>` : "");
}
function textEl(D, sel, text) { const e = $(D, sel); if (e) e.textContent = text; }
function findByText(D, sel, re) { return $$(D, sel).find((e) => re.test(e.textContent)); }

// ------------------------------------------------------------------ hashes (scoped Svelte classes) read from the real DOM
const P = parse("p-principal"), A = parse("p-acoes"), I = parse("p-inventario"), C = parse("p-chat"), K = parse("p-picker"), G = parse("gm-npc-empty"), GM = parse("gm-map");
const H = {
  lc: hashOf(P, ".level-card"), ps: hashOf(P, ".plan-slot"), pe: hashOf(P, ".plan-empty-slot"), ob: hashOf(P, ".plan-optional-badge"),
  sit: hashOf(P, ".sit-card"), sh: hashOf(A, ".strike-row"), cs: (css.match(/\.cs-strip\.(svelte-[a-z0-9]+)/) || [])[1],
  pk: hashOf(K, ".picker-modal"), dp: hashOf(K, ".details-panel"), npc: hashOf(G, ".npc-header"), port: hashOf(G, ".actor-portrait"),
  msg: hashOf(C, ".msg"), ab: hashOf(C, ".ability-card"), nest: hashOf(C, ".nested-roll"),
};
console.log("hashes", H);

const TPL = {
  npcHeader: $(G, ".npc-header").outerHTML,
  npcStat: $(G, ".statblock-row").outerHTML,
  npcSaves: $(G, ".saves-row").outerHTML,
  npcCond: $(G, ".conditions-bar").outerHTML,
  npcTitlebar: $(G, ".fusion-window__titlebar").outerHTML,
  pickerBackdrop: $(K, ".picker-backdrop").outerHTML,
  chatRow: $$(C, ".chat-log__row")[1].outerHTML,
  chatRollRow: $$(C, ".chat-log__row")[3].outerHTML,
};

const BODY = {};
const MAPS = {};
["a", "b", "c"].forEach((s) => { MAPS["pl" + s] = b64(`map-${s}-pl.png`); MAPS["gm" + s] = b64(`map-${s}-gm.png`); });

// ------------------------------------------------------------------ T1: Plano (player sheet, Principal tab, tall window)
{
  const D = parse("p-principal"); renameBhrotto(D);
  setWin(D, 920, 1860, 80, 70);
  canvasLayer(D, "mapBgSheet", null);
  // companion sub-slot under "Animal de Companhia"
  const callSlot = $(D, ".level-card__slot--nested");
  const slot1 = findByText(D, ".level-card__slot", /Animal de Companhia/);
  const sub1 = D.createElement("div"); sub1.className = `level-card__slot ${H.lc} level-card__slot--nested nw`; sub1.setAttribute("data-note", "D-B09"); sub1.setAttribute("data-fn", "t1sub1");
  slot1.after(sub1);
  // second sub-slot under the free-archetype nested "Chamar Companheiro"
  const sub2 = D.createElement("div"); sub2.className = `level-card__slot ${H.lc} level-card__slot--nested nw`; sub2.setAttribute("data-note", "D-B09"); sub2.setAttribute("data-fn", "t1sub2");
  callSlot.after(sub2);
  // Noble Bloom: the whole real slot is re-rendered with the eligibility seal
  const nbHost = findByText(D, ".level-card__slot", /Floração Nobre/);
  nbHost.setAttribute("data-fn", "t1nbslot");
  // GM exceptions card, after level 3
  const lv = $$(D, ".level-card"); const last = lv[lv.length - 1];
  const gmcard = D.createElement("div"); gmcard.className = `level-card ${H.lc} nw`; gmcard.setAttribute("data-when", "t1view=mestre"); gmcard.setAttribute("data-note", "D-B12"); gmcard.setAttribute("data-fn", "t1gmcard");
  last.after(gmcard);
  // overlay for the type picker lives inside the sheet shell (like the real picker backdrop)
  const shell = $(D, ".pf2e-sheet-shell");
  const pk = D.createElement("div"); pk.style.display = "contents"; pk.setAttribute("data-fn", "t1picker"); shell.appendChild(pk);
  // header GM badge slot
  const title = $(D, ".fusion-window__title"); const hb = D.createElement("span"); hb.setAttribute("data-fn", "t1viewbadge"); title.after(hb);
  BODY.t1 = D.body.innerHTML;
}

// ------------------------------------------------------------------ T2: companion sheet (real NPC sheet look), GM chrome
{
  const D = parse("gm-npc-empty");
  setWin(D, 760, 1560, 80, 70);
  canvasLayer(D, "mapBgGmS", null);
  const win = $(D, ".fusion-window");
  const content = $(D, ".fusion-window__content");
  content.innerHTML = `<div class="pf2e-sheet pf2e-npc-sheet ${H.npc}" role="document" data-fn="t2sheet"></div>`;
  $(D, ".fusion-window__titlebar").innerHTML = TPL.npcTitlebar.replace(/^<div[^>]*>/, "").replace(/<\/div>$/, "");
  const t = $(D, ".fusion-window__title"); t.setAttribute("data-fn", "t2title"); t.textContent = "";
  BODY.t2 = D.body.innerHTML;
}

// ------------------------------------------------------------------ T3: Bhrotto, Ações tab
{
  const D = parse("p-acoes"); renameBhrotto(D);
  setWin(D, 920, 2330, 80, 70);
  canvasLayer(D, "mapBgSheet", null);
  // title bar: mounted chip
  const title = $(D, ".fusion-window__title"); const mc = D.createElement("span"); mc.setAttribute("data-fn", "t3titlechip"); title.after(mc);
  // header defences: wrap CA value and Reflexos total with hooks
  const ca = findByText(D, ".defense-block", /^\s*20\s*CA\s*$/) || $(D, ".defense-block");
  $(ca, ".defense-block__value").setAttribute("data-fn", "t3ac");
  const ref = $$(D, ".save-block").find((b) => /Reflexos/.test(b.textContent));
  $(ref, ".save-block__mod").setAttribute("data-fn", "t3ref");
  // panel top: Alvo e Presa + Estados de combate strip
  const panel = $(D, ".tab-panel--actions");
  const top = D.createElement("div"); top.setAttribute("data-fn", "t3top"); panel.insertBefore(top, panel.firstChild);
  // replace first strike row with the War Flail (hooked), keep Punho
  const rows = $$(D, ".strike-list > li");
  rows[0].setAttribute("data-fn", "t3strike");
  // after strike list: breakdown + athletics + mounted rules
  const sl = $(D, ".strike-list");
  const after = D.createElement("div"); after.setAttribute("data-fn", "t3after"); sl.after(after);
  BODY.t3 = D.body.innerHTML;
}

// ------------------------------------------------------------------ T4: map (two chromes: player / GM)
{
  const D = parse("p-chat"); renameBhrotto(D);
  const w = $(D, ".fusion-window-host"); if (w) w.innerHTML = "";
  canvasLayer(D, "mapBgPl", "mapOvPl");
  BODY.t4p = D.body.innerHTML;
  const E = GM; canvasLayer(E, "mapBgGm", "mapOvGm");
  BODY.t4g = E.body.innerHTML;
}

// ------------------------------------------------------------------ T5: chat cards (player chrome, chat drawer)
{
  const D = parse("p-chat"); renameBhrotto(D);
  const w = $(D, ".fusion-window-host"); if (w) w.innerHTML = "";
  canvasLayer(D, "mapBgPl", "mapOvPl");
  const log = $(D, ".chat-log"); log.setAttribute("data-fn", "t5log"); log.innerHTML = "";
  BODY.t5 = D.body.innerHTML;
}

// ------------------------------------------------------------------ T6: Inventário
{
  const D = parse("p-inventario"); renameBhrotto(D);
  setWin(D, 920, 900, 80, 70);
  canvasLayer(D, "mapBgSheet", null);
  const panel = $(D, ".tab-panel--inventory");
  // wallet: hook (readonly for players, GM button)
  const wallet = $(D, ".wallet");
  wallet.setAttribute("data-fn", "t6wallet");
  // list: hook weapon row + editor
  const list = $(D, ".inventory-list");
  const rows = $$(D, ".inventory-row");
  rows[0].setAttribute("data-fn", "t6weapon");
  const ed = D.createElement("li"); ed.setAttribute("data-fn", "t6editor"); ed.setAttribute("data-when", "t6open"); ed.className = `inventory-row ${H.sh} nw`; ed.setAttribute("data-note", "D-B06"); rows[0].after(ed);
  rows[1].querySelector(".inventory-row__name").textContent = "Chain Mail";
  const modal = D.createElement("div"); modal.style.display = "contents"; modal.setAttribute("data-fn", "t6modal"); $(D, ".pf2e-sheet-shell").appendChild(modal);
  BODY.t6 = D.body.innerHTML;
}

// ------------------------------------------------------------------ assemble
const engine = fs.readFileSync(path.join(__dirname, "engine.js"), "utf8");
const page = fs.readFileSync(path.join(__dirname, "page.html"), "utf8");
const extraCss = fs.readFileSync(path.join(__dirname, "extra.css"), "utf8");
const pageCss = fs.readFileSync(path.join(__dirname, "page.css"), "utf8");

const bodies = Object.entries(BODY).map(([k, v]) => `<script type="text/html" id="body-${k}">${v.replace(/<\/script/gi, "<\\/script")}</script>`).join("\n");
const out = page
  .replace("/*__PAGECSS__*/", () => pageCss)
  .replace("<!--__BODIES__-->", () => bodies)
  .replace("/*__APPCSS__*/", () => css.replace(/<\/style/gi, "<\\/style"))
  .replace("/*__EXTRACSS__*/", () => extraCss)
  .replace("/*__DATA__*/", () => `const H = ${JSON.stringify(H)}; const TPL = ${JSON.stringify(TPL)}; const MAPS = ${JSON.stringify(MAPS)};`)
  .replace("/*__ENGINE__*/", () => engine);
fs.writeFileSync(OUT, out);
console.log("wrote", OUT, (out.length / 1024).toFixed(0) + " KB");
