/* engine.js — runtime of the prototype page. Frames are iframes whose document is the REAL app DOM + CSS (snapshots);
   this file fills the "data-fn" hooks with the NEW fragments (built with the app's own scoped classes, H.*) and runs the state buttons. */
const S = {
  csOpen: null,
  screen: 't1', t1pick: 'urso', t1pick2: 'closed', t1sel: 'urso', t1gm: false, t1view: 'jogador',
  t2sheet: 'urso', comp: 'urso', mounted: false, cmd: true, support: false, supportFrom: 'urso',
  target: 'ogro', prey: 'none', mh: false, reach: false, log: '', moved: false, mapview: 'jogador',
  t5deg: 'sucesso', t5grp: 'ogro', t6open: true, pot: 0, stk: 1, t6view: 'jogador', t6wallet: false, props: ['', '', ''],
};
const LBL = ['', 'Runa de ataque', 'Runa de ataque maior', 'Runa de ataque suprema'];
const TG = {
  ogro: { n: 'Ogro Brutamontes', size: 'Grande', idx: 2, ca: 20, fort: 21, reach: true },
  gigante: { n: 'Gigante da Colina', size: 'Enorme', idx: 3, ca: 24, fort: 27, reach: false },
};
const NAME = { urso: 'Urso jovem', antilope: 'Antílope jovem' };
const COMP = {
  urso: { name: 'Urso jovem', ini: 'UJ', color: 'rgb(46, 160, 140)', size: 'Pequeno', hp: 32, ac: 17, perc: '+6', speed: 35, saves: ['+7', '+7', '+6'],
    skills: [['Acrobacia', '+7'], ['Atletismo', '+8'], ['Intimidação', '+5']],
    strikes: [['Mandíbulas', '+8', '1d8+3', 'perfurante', []], ['Garra', '+8', '1d6+3', 'cortante', ['ágil']]],
    senses: 'visão na penumbra, faro (impreciso, 30 pés)',
    apoio: 'Até o início do seu próximo turno, cada Golpe do dono que acerte criatura no alcance do Urso causa +1d8 cortante (2d8 se o Golpe for ágil ou selvagem).', apoioShort: '+1d8 cortante' },
  antilope: { name: 'Antílope jovem', ini: 'AJ', color: 'rgb(197, 106, 46)', size: 'Médio', hp: 30, ac: 18, perc: '+6', speed: 40, saves: ['+7', '+8', '+6'],
    skills: [['Acrobacia', '+8'], ['Atletismo', '+7'], ['Sobrevivência', '+6']],
    strikes: [['Chifres', '+8', '1d6+2', 'perfurante', ['acuidade']], ['Casco', '+8', '1d4+2', 'contundente', ['ágil', 'acuidade']]],
    senses: 'visão na penumbra',
    apoio: 'Só com o dono montado: até o início do seu próximo turno, os Golpes do dono que causem dano a criatura no alcance do Antílope causam +1d6 de sangramento persistente (2d6 se ágil ou selvagem).', apoioShort: '1d6 sangramento' },
};
const $ = (s, r = document) => [...r.querySelectorAll(s)];
const mountedOn = () => S.comp === 'antilope' && S.mounted;
const fmt = (n) => (n >= 0 ? '+' : '−') + Math.abs(n);
const tpl = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const PX = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/* ------------------------------------------------------------------ state predicates for data-when */
function holds(cond) {
  return cond.split('&').every((c) => {
    c = c.trim();
    if (c === 'mountedOn') return mountedOn();
    if (c === '!mountedOn') return !mountedOn();
    if (c.includes('=')) { const [k, v] = c.split('='); return v.split(',').includes(String(S[k])); }
    return c[0] === '!' ? !S[c.slice(1)] : !!S[c];
  });
}
function setVal(k, v) {
  S[k] = v === '1' ? true : v === '0' ? false : v;
  if (k === 'comp' && v === 'urso') S.mounted = false;
  if (k === 'comp' && v === 'antilope') S.t2sheet = 'antilope';
  if (k === 'prey' && v !== 'none') S.target = v;
  if (k === 'prey' && v === 'none') S.mh = false;
  if (k === 't1pick' && (v === 'urso' || v === 'antilope')) S.t1sel = v;
}

/* ------------------------------------------------------------------ small builders with the app's own classes */
const sitRow = (target, bonus, body, o = {}) => `<li class="sit-row ${H.sit}${o.cls ? ' ' + o.cls : ''}" style="${o.off ? 'opacity:.55;' : ''}"><div class="sit-row__head ${H.sit}"><span class="sit-row__target ${H.sit}">${target}</span> ${bonus ? `<span class="sit-row__bonus sit-bonus ${H.sit}${o.pen ? ' sit-bonus--penalty' : ''}">${bonus}</span>` : ''}</div><div class="sit-row__body ${H.sit}">${body}</div></li>`;
const sitCard = (heading, hint, rows, o = {}) => `<section class="sit-card ${H.sit} nw"${o.note ? ` data-note="${o.note}"` : ''}><h3 class="sit-card__heading ${H.sit}">${heading}</h3>${hint ? `<p class="sit-card__hint ${H.sit}">${hint}</p>` : ''}<ul class="sit-list ${H.sit}">${rows}</ul></section>`;
const badge = (txt, k = '') => `<span class="pn-badge${k ? ' pn-badge--' + k : ''}">${txt}</span>`;
const planSlot = (name, en, type, typeEn, o = {}) => `<div class="plan-slot ${H.ps} plan-slot--editable"${o.style ? ` style="${o.style}"` : ''}><button type="button" class="plan-slot__body ${H.ps}" ${o.attrs || ''}><span class="plan-slot__check ${H.ps}" aria-hidden="true"${o.checkStyle ? ` style="${o.checkStyle}"` : ''}>${o.check || '✓'}</span> <span class="plan-slot__main ${H.ps}"><span class="plan-slot__name ${H.ps}">${name} ${en ? `<span class="plan-slot__name-en ${H.ps}">${en}</span>` : ''}${o.seal || ''}</span> <span class="plan-slot__type ${H.ps}">${type}${typeEn ? `<span class="plan-slot__type-en ${H.ps}">${typeEn}</span>` : ''}</span></span> <span class="plan-slot__edit ${H.ps}" aria-hidden="true">${o.edit || '✎'}</span></button>${o.remove ? `<button type="button" class="plan-slot__remove ${H.ps}" aria-label="${o.remove[1]}" ${o.remove[0]}>×</button>` : ''}</div>`;
const sealOb = (txt, k) => `<span class="plan-optional-badge ${H.ob}"${k === 'bad' ? ' style="color:var(--fusion-danger);border-color:var(--fusion-danger);background:var(--fusion-danger-dim)"' : k === 'gm' ? ' style="color:#5fb3d9;border-color:#5fb3d9;background:rgba(95,179,217,.14)"' : ''}>${txt}</span>`;

/* ------------------------------------------------------------------ T3 numbers (breakdown) */
function t3calc() {
  const T = S.target === 'none' ? null : TG[S.target]; const isPrey = !!T && S.prey === S.target; const rows = [];
  let atk = 9 + S.pot, die = S.reach ? 8 : 10, extra = '', nd = 1 + S.stk;
  rows.push(['Base de ataque', fmt(9), 'Nível 3 + treinado 2 + FOR 4 (ficha real)', true]);
  if (S.pot) rows.push(['Runa de potência', fmt(S.pot), `+${S.pot} de item no ataque`, true]);
  rows.push(S.stk ? ['Runa de ataque', nd + ' dados', `${LBL[S.stk]}: ${nd}d${die} no lugar de 1d${die}`, true] : ['Runas de dados', '—', 'sem runa de ataque', false]);
  rows.push(S.reach ? ['Alcance Prênsil', '−1 passo', 'ligado: arma de duas mãos ganha alcance; reduz em um o passo do dado da arma', true] : ['Alcance Prênsil', '—', 'desligado', false]);
  const cname = COMP[S.comp].name;
  if (S.support) {
    const fromAnt = S.supportFrom === 'antilope';
    const same = !!T && T.reach; const applies = same && (!fromAnt || mountedOn());
    const why = !T ? 'sem alvo selecionado' : !same ? `${T.n} está fora do alcance do ${fromAnt ? 'antílope' : 'urso'} (só vale em criatura no alcance dele)` : (fromAnt && !mountedOn() ? 'o Apoio do antílope só vale com o dono montado' : 'alvo no alcance do companheiro; expira no início do seu próximo turno');
    rows.push([`Apoio do ${fromAnt ? 'Antílope' : 'Urso'}`, COMP[S.supportFrom].apoioShort, why, applies]);
    if (applies) extra = fromAnt ? ' + 1d6 sangramento' : ' + 1d8 cortante';
  } else rows.push(['Apoio do companheiro', '—', 'inativo (Comandar e Apoio na ficha do companheiro)', false]);
  if (S.mh) { rows.push(['Caçador de Monstros', '+1', isPrey ? 'o alvo é a Presa; removido depois da rolagem' : 'ativo, mas o alvo não é a Presa', isPrey]); if (isPrey) atk += 1; }
  else rows.push(['Caçador de Monstros', '—', 'inativo: vem de sucesso crítico em Rememorar Conhecimento', false]);
  rows.push(['Astúcia', S.prey !== 'none' ? 'CA +1' : '—', 'defesa: +1 na CA contra a Presa; não entra no ataque', false]);
  if (mountedOn()) {
    rows.push(['Montado: MAP', 'dividido', 'penalidade de ataques múltiplos compartilhada com o antílope', true]);
    rows.push(['Montado: Reflexos', '−2', 'defesa; Reflexos +8 → +6 enquanto montado', true]);
  }
  return { atk, rows, dmg: `${nd}d${die} +4 concussão${extra}`, cname };
}
const mountRules = [
  ['MAP compartilhado', 'você e a montaria dividem a penalidade: seu Golpe e depois o da montaria = −5', 'PC, Regras 2435'],
  ['Reflexos', '−2 circunstância enquanto montado (Reflexos +8 → +6)', 'PC, Regras 2436'],
  ['Ações de movimento', 'a única com traço mover que você usa é Montar (desmontar)', 'PC, Ação: Montar'],
  ['Ações da montaria', 'age na sua iniciativa; sem Comandar um Animal desperdiça as ações', 'PC p. 242'],
  ['Espaço e alcance', 'você ocupa o espaço da montaria; alcance medido de qualquer casa dela', 'PC, Regras 2435'],
  ['Defesas', 'atacantes escolhem você ou a montaria; área atinge ambos', 'PC, Regras 2436'],
  ['Antílope (Montaria)', 'só Velocidade terrestre e sem mover + Apoio no mesmo turno, exceto pela habilidade Montaria (ignora ambas)', 'HotW p. 90'],
];
const mountRows = () => mountRules.map((r) => `<li class="sit-row ${H.sit}"><div class="sit-row__head ${H.sit}"><span class="sit-row__target ${H.sit}">${r[0]}</span> <span class="pn-src" style="margin-left:auto">${r[2]}</span></div><div class="sit-row__body ${H.sit}">${r[1]}</div></li>`).join('');

/* ------------------------------------------------------------------ generated fragments */
function csCard(o) {
  const st = o.on ? 'ligado' : 'desligado'; const open = S.csOpen === o.key;
  return `<li class="cs-card cs-chip ${H.cs}${o.on ? ' cs-card--on' : ''}${o.locked ? ' cs-card--locked' : ''}${open ? ' cs-chip--open' : ''}" data-option="${o.key}"><div class="cs-card__head ${H.cs}"><button type="button" role="switch" class="cs-switch ${H.cs}" aria-checked="${o.on}" aria-label="Ligar ${o.name}" ${o.locked ? 'disabled' : ''} title="${o.locked ? o.locked : ''}" data-flip="${o.key}"><span class="cs-switch__track ${H.cs}" aria-hidden="true"><span class="cs-switch__thumb ${H.cs}"></span></span></button><button type="button" class="cs-card__name cs-chip__name ${H.cs}" aria-expanded="${open}" data-cs="${o.key}">${o.name}</button><span class="cs-card__state ${H.cs}${o.on ? ' cs-card__state--on' : ''}">${st}</span></div>${open ? `<div class="cs-card__body cs-pop ${H.cs}" role="dialog">${o.locked ? `<span class="cs-card__locked ${H.cs}">${o.locked}</span>` : ''}<span class="cs-card__effect ${H.cs}">${o.effect}</span>${o.note ? `<span class="cs-card__note ${H.cs}">${o.note}</span>` : ''}<span class="cs-card__source ${H.cs}">Fonte: ${o.source}</span></div>` : ''}</li>`;
}
const fnT3 = {
  top() {
    const T = S.target === 'none' ? null : TG[S.target];
    const tgt = T ? `<span class="pn-badge pn-badge--bad">◎ mirado</span> <b>${T.n}</b> ${badge(T.size)} <span class="pn-mono pn-hint">CA ${T.ca} · Fortitude CD ${T.fort}</span> ${S.prey === S.target ? badge('◆ Presa', 'prey') : (S.prey !== 'none' ? badge('a Presa é outro token: ' + TG[S.prey].n) : '')}` : '<span class="pn-hint">Nenhum alvo: mire um token no mapa.</span>';
    const huntLabel = S.prey !== 'none' && S.prey === S.target ? `Presa: ${TG[S.prey].n}` : 'Caçar Presa';
    const comps = ['urso', 'antilope'].map((k) => {
      const st = S.comp === k ? (k === 'antilope' && S.mounted ? 'montado' : 'ativo') : 'em espera';
      return `<button type="button" class="pn-chip pn-chip--comp" data-goto="t2" data-set="t2sheet=${k}"><b>${NAME[k]}</b> ${badge(st, S.comp === k ? 'ok' : '')} <span class="pn-link">ficha →</span></button>`;
    }).join(' ');
    const rows =
      sitRow('Alvo', '', tgt) +
      sitRow('Presa', '', `<div class="pn-row"><button type="button" class="pn-btn pn-btn--primary" data-act="hunt" ${T ? '' : 'disabled'}>${huntLabel}</button><button type="button" class="pn-btn" data-act="recall">Rememorar Conhecimento (Caçador de Monstros)</button><span class="pn-hint">Caçar Presa: 1 ação</span></div>`) +
      sitRow('Companheiros', '', `<div class="pn-row">${comps}</div><div class="pn-hint" style="margin-top:3px">Sem aba Pets: o vínculo vive aqui. Trocar de companheiro leva 1 minuto de exploração.</div>`) +
      (S.log ? sitRow('Última rolagem', '', `<span class="pn-mono" style="font-size:11.5px">${S.log}</span>`) : '');
    const strip = `<section class="cs-strip ${H.cs} nw" data-note="Estados de combate" aria-label="Estados de combate"><h3 class="cs-strip__heading ${H.cs}">Estados de combate</h3><p class="cs-strip__hint ${H.cs}">Ligue o que estiver valendo agora: a ficha soma o efeito nos golpes e nos totais.</p><ul class="cs-list ${H.cs}">` +
      csCard({ key: 'reach', name: 'Alcance Prênsil', on: S.reach, effect: 'Alcance Prênsil: arma de duas mãos ganha alcance; reduz em um o passo do dado da arma.', note: '', source: 'Alcance Prênsil (Leshy)' }) +
      csCard({ key: 'mh', name: 'Caçador de Monstros', on: S.mh && S.prey !== 'none', locked: S.prey === 'none' ? 'precisa de uma Presa marcada' : '', effect: '+1 circunstância no próximo ataque contra a Presa.', note: 'Só em sucesso crítico no Rememorar Conhecimento; some depois da rolagem.', source: 'Caçador de Monstros' }) +
      csCard({ key: 'support', name: `Apoio do ${COMP[S.comp].name.split(' ')[0]}`, on: S.support, locked: S.cmd ? '' : 'precisa de Comandar o companheiro', effect: COMP[S.comp].apoioShort + ' nos Golpes contra criatura no alcance do companheiro.', note: 'Expira no início do seu próximo turno.', source: 'Apoio (ficha do companheiro)' }) +
      `</ul></section>`;
    return sitCard('Alvo e Presa', 'O alvo é o token mirado no mapa (persistente). Caçar Presa marca o token; marcar outro solta a marca anterior.', rows, { note: 'D-B05' }) + strip;
  },
  strike() {
    const a = t3calc();
    const mp = mountedOn() ? ' (compartilhado com a montaria)' : '';
    return `<div class="strike-row__header ${H.sh}"><span class="strike-row__name ${H.sh}">Mangual de Guerra</span> <span class="trait-badge ${H.sh} nw">${S.reach ? 'alcance 10 pés' : 'corpo a corpo'}</span></div>
<div class="strike-row__variants ${H.sh}" role="group" aria-label="Rolagens de ataque do Mangual de Guerra">
<button class="map-btn ${H.sh}" data-act="roll" aria-label="Rolar Mangual de Guerra (MAP 0)"><span class="map-btn__total ${H.sh}">${fmt(a.atk)}</span> <span class="map-btn__label ${H.sh}">MAP 0</span></button><button class="map-btn ${H.sh}" aria-label="MAP 1"><span class="map-btn__total ${H.sh}">${fmt(a.atk - 5)}</span> <span class="map-btn__label ${H.sh}">MAP 1</span></button><button class="map-btn ${H.sh}" aria-label="MAP 2"><span class="map-btn__total ${H.sh}">${fmt(a.atk - 10)}</span> <span class="map-btn__label ${H.sh}">MAP 2</span></button> <button class="map-btn map-btn--damage ${H.sh}" aria-label="Rolar dano"><span class="map-btn__label ${H.sh}">Dano</span></button> <button class="map-btn map-btn--crit ${H.sh}" aria-label="Rolar dano crítico"><span class="map-btn__label ${H.sh}">Crítico</span></button></div>
<div class="strike-row__damage ${H.sh}">Dano: <span class="damage-formula ${H.sh}">${a.dmg}</span>${mp ? `<span class="pn-hint">${mp}</span>` : ''}</div>
<div class="strike-row__traits ${H.sh}"><span class="trait-badge ${H.sh}">desarmar</span><span class="trait-badge ${H.sh}">varredura</span><span class="trait-badge ${H.sh}">derrubar</span>${S.reach ? `<span class="trait-badge ${H.sh} nw">alcance</span>` : ''}</div>`;
  },
  after() {
    const a = t3calc(); const T = S.target === 'none' ? null : TG[S.target];
    const rows = a.rows.map((r) => sitRow(r[0], r[1] === '—' ? '' : r[1], r[2], { off: !r[3], pen: String(r[1]).startsWith('−') })).join('');
    const bd = sitCard('Contra a presa', 'O que está ativo e por que vale (ou não) contra este alvo. Congelado no card do chat no momento da rolagem.', rows, { note: 'D-B05' });
    const mnt = mountedOn() ? sitCard('Combate montado', 'Ativo: Bhrotto sobre o Antílope jovem.', mountRows(), { note: 'D-B03' }) : '';
    return bd + mnt;
  },
  ac() { return S.prey !== 'none' ? `20<span class="pn-defvs nw">21 vs Presa</span>` : '20'; },
  ref() { return mountedOn() ? `+6<span class="pn-defvs pn-defvs--pen nw">−2 montado</span>` : '+8'; },
  chip() { return mountedOn() ? `<span class="pn-chip-m nw" data-goto="t2" data-set="t2sheet=antilope" data-note="D-B03">Montado · Antílope jovem</span>` : `<span class="pn-chip-m pn-chip-m--off nw">a pé</span>`; },
};

/* NPC sheet (T2): the real NPC sheet markup with the derived numbers */
function npcSheet() {
  const c = COMP[S.t2sheet]; const active = S.t2sheet === S.comp; const h = H.npc;
  const hdr = tpl(TPL.npcHeader);
  hdr.querySelector('.actor-portrait').textContent = c.ini; hdr.querySelector('.actor-portrait').style.background = c.color;
  hdr.querySelector('.actor-portrait').setAttribute('aria-label', 'Retrato de ' + c.name);
  hdr.querySelector('.npc-header__name').textContent = c.name; hdr.querySelector('.npc-header__level').textContent = 'Creature 3';
  const inp = hdr.querySelector('input'); inp.setAttribute('max', c.hp); inp.setAttribute('value', c.hp); inp.setAttribute('aria-label', `Current HP (of ${c.hp})`);
  hdr.querySelector('.npc-hp__max').textContent = c.hp;
  const stat = `<div class="statblock-row ${h}"><div class="stat-block ${h}" aria-label="Armor Class ${c.ac}"><span class="stat-block__value ${h}">${c.ac}</span> <span class="stat-block__label ${h}">AC</span></div> <button class="stat-block stat-block--rollable ${h}"><span class="stat-block__value ${h}">${c.perc}</span> <span class="stat-block__label ${h}">Perc</span></button> <div class="stat-block ${h}"><span class="stat-block__value ${h}">${c.speed}</span> <span class="stat-block__label ${h}">Speed</span></div></div>`;
  const saves = `<div class="saves-row ${h}">${['Fort', 'Refl', 'Will'].map((l, i) => `<button class="save-block ${h}"><span class="save-block__mod ${h}">${c.saves[i]}</span> <span class="save-block__label ${h}">${l}</span></button>`).join('')}</div>`;
  const skills = `<div class="npc-skills ${h}"><span class="npc-skills__label ${h}">Skills</span><div class="npc-skills__list ${h}">${c.skills.map((s) => `<button class="skill-chip ${h}">${s[0]} ${s[1]}</button>`).join('')}</div></div>`;
  const strikes = `<section class="npc-section ${h}" aria-label="Strikes"><h3 class="npc-section__header ${h}">Strikes</h3><ul class="npc-strike-list ${h}">${c.strikes.map((s) => `<li class="npc-strike-row ${h}"><button class="npc-strike-btn ${h}"><span class="npc-strike-btn__name ${h}">${s[0]}</span><span class="npc-strike-btn__bonus ${h}">${s[1]}</span></button><div class="npc-strike-damage ${h}"><span class="npc-strike-damage__formula ${h}">${s[2]}</span> <span class="npc-strike-damage__type ${h}">${s[3]}</span></div>${s[4].length ? `<div class="npc-strike-traits ${h}">${s[4].map((t) => `<span class="trait-badge ${h}">${t}</span>`).join('')}</div>` : ''}</li>`).join('')}</ul></section>`;
  const acts = `<section class="npc-section ${h}" aria-label="Actions"><h3 class="npc-section__header ${h}">Actions</h3><ul class="npc-action-list ${h}"><li class="npc-action-row ${h}"><div class="npc-action-header ${h}"><span class="npc-action-name ${h}">Apoio (Support)</span><span class="trait-badge ${h}">companheiro</span></div><p class="npc-action-desc ${h}">${c.apoio}</p></li>${S.t2sheet === 'antilope' ? `<li class="npc-action-row ${h}"><div class="npc-action-header ${h}"><span class="npc-action-name ${h}">Montaria (Mount)</span></div><p class="npc-action-desc ${h}">Pode carregar um cavaleiro de tamanho menor; carregando, usa só a Velocidade terrestre e pode mover e Apoiar no mesmo turno.</p></li>` : ''}</ul></section>`;
  const info = `<div class="pn-card pn-card--comp nw" data-note="D-B01" style="margin:8px 12px 0"><div class="pn-row">${badge('Jovem', 'comp')} ${badge(c.size)} ${S.t2sheet === 'antilope' ? badge('Montaria', 'comp') : ''} ${badge(active ? 'ativo' : 'em espera', active ? 'ok' : '')} <span class="pn-sp"></span><button class="pn-link" data-goto="t3">← Bhrotto Raiz-funda</button></div><div class="pn-hint" style="margin-top:4px">companheiro de Bhrotto Raiz-funda · nível 3 herdado do dono · recalculado no servidor quando o dono muda · somente leitura (D-B01) · sentidos: ${c.senses}</div></div>
<div class="pn-card pn-card--warn nw" data-note="pendência" style="margin:6px 12px 0"><b>Caçar Presa compartilhado:</b> só o companheiro que veio do talento Animal de Companhia recebe Caçar Presa e Astúcia do dono (PC p. 127). ${badge('pendência do jogador', 'warn')} <span class="pn-hint">depende de qual companheiro veio do talento</span></div>`;
  const cmd = `<section class="npc-section ${h} nw" data-note="D-B10"><h3 class="npc-section__header ${h}">Ações do companheiro</h3><div class="pn-row"><button class="pn-btn ${S.cmd ? '' : 'pn-btn--primary'}" data-flip="cmd">${S.cmd ? 'Comandado (2 ações)' : 'Comandar (1 ação do dono)'}</button><button class="pn-btn" data-act="apoio" ${S.cmd ? '' : 'disabled'}>Apoio: ${c.apoioShort}</button><span class="pn-hint">${S.cmd ? '' : 'Apoio exige Comandar antes'}</span></div>${S.support ? `<div class="pn-card pn-card--comp" style="margin-top:6px"><b>Apoio aplicado em Bhrotto Raiz-funda.</b> ${COMP[S.supportFrom].apoioShort} nos Golpes contra criatura no alcance. ${badge('expira no início do próximo turno do dono', 'warn')}</div>` : ''}</section>`;
  const mont = S.t2sheet === 'antilope' ? `<section class="npc-section ${h} nw" data-note="D-B03"><h3 class="npc-section__header ${h}">Montaria</h3><div class="pn-card"><div class="pn-row"><span class="pn-hint">Cavaleiro:</span> <span class="pn-chip">Bhrotto Raiz-funda ${badge('Pequeno')}</span> ${badge(S.mounted ? 'montado' : 'desmontado', S.mounted ? 'ok' : '')}<span class="pn-sp"></span><button class="pn-btn ${S.mounted ? '' : 'pn-btn--primary'}" data-set="mounted=${S.mounted ? 0 : 1}">${S.mounted ? 'Desmontar (1 ação)' : 'Montar (1 ação)'}</button></div><p class="pn-hint" style="margin:6px 0 0">Montar (1 ação, movimento) exige criatura voluntária adjacente de tamanho ao menos 1 acima do cavaleiro (Médio &gt; Pequeno: <b style="color:var(--fusion-success)">ok</b>; o Urso, Pequeno, não serve). Montado, o token do Bhrotto anda junto com este.</p></div><ul class="sit-list ${H.sit}" style="margin-top:8px">${mountRows()}</ul></section>` : '';
  const call = `<section class="npc-section ${h} nw" data-note="D-B04"><h3 class="npc-section__header ${h}">Chamar Companheiro</h3><div class="pn-card"><div class="pn-row"><b>${c.name}: ${active ? 'ativo' : 'em espera'}</b> ${badge('1 minuto · exploração', 'warn')}<span class="pn-sp"></span><button class="pn-btn" data-set="comp=${active ? (S.t2sheet === 'urso' ? 'antilope' : 'urso') : S.t2sheet}">${active ? 'Trocar para ' + NAME[S.t2sheet === 'urso' ? 'antilope' : 'urso'] : 'Trazer ' + c.name + ' para o mapa'}</button></div><p class="pn-hint" style="margin:6px 0 0">Só um companheiro fica ativo por vez (Beastmaster permite até 4). É uma atividade de exploração de 1 minuto, portanto não se usa em combate: o ativo vira "em espera" (sem token, sem agir) e o outro entra.</p></div></section>`;
  return hdr.outerHTML + info + stat + saves + skills + TPL.npcCond.replace('class="conditions-bar', 'class="conditions-bar') + strikes + acts + cmd + mont + call;
}

/* picker (T1): reuses the real picker modal markup */
function t1picker() {
  const which = S.t1pick === 'open' ? 1 : S.t1pick2 === 'open' ? 2 : 0; if (!which) return '';
  const taken = null; /* D-B15: same type may be chosen again */
  const root = tpl(TPL.pickerBackdrop);
  root.querySelector('.picker-modal__title').textContent = which === 1 ? 'Escolher companheiro' : 'Escolher o 2º companheiro';
  root.querySelector('.picker-search__input').setAttribute('placeholder', 'Buscar tipo de companheiro…');
  root.querySelector('.picker-filters').innerHTML = `<button type="button" class="picker-chip ${H.pk}">Jovem</button><button type="button" class="picker-chip ${H.pk}">nível 3 do dono</button>`;
  const rowT = root.querySelector('.picker-row').cloneNode(true);
  const MAT = {
    urso: { first: 'Abraço de Urso', m: 'Cresce para Médio; For, Des, Con e Sab +1; Percepção e salvaguardas viram especialista; golpes passam de 1 para 2 dados.', n: 'Ágil: Des +2, +2 de dano, Apoio vira +2d8 cortante; aprende a manobra avançada Abraço de Urso (garra extra: alvo agarrado).', s: 'Selvagem: For +2, +3 de dano, Atletismo especialista, Apoio vira +2d8 cortante; aprende Abraço de Urso.', i: 'Incrível: especialização (a confirmar).' },
    antilope: { first: 'Retirada Saltitante', m: 'Cresce para Grande; For, Des, Con e Sab +1; Percepção e salvaguardas viram especialista; golpes passam de 1 para 2 dados.', n: 'Ágil: Des +2, +2 de dano, Apoio vira +2d6 de sangramento; aprende a manobra avançada Retirada Saltitante (dois Saltos).', s: 'Selvagem: For +2, +3 de dano, Atletismo especialista, Apoio vira +2d6 de sangramento; aprende Retirada Saltitante.', i: 'Incrível: especialização (a confirmar).' },
  };
  const mkRow = (k, en, traits) => { const r = rowT.cloneNode(true); r.classList.toggle('picker-row--selected', S.t1sel === k && taken !== k); r.setAttribute('data-set', 't1sel=' + k); r.querySelector('.picker-row__rank').textContent = '3'; r.querySelector('.picker-row__name-text').textContent = NAME[k]; r.querySelector('.picker-row__name-en').textContent = en + (taken === k ? ' · já tomado no nível 1' : ''); r.querySelector('.picker-row__traits').innerHTML = traits.map((t) => `<span class="picker-row__trait ${H.pk}">${t}</span>`).join('') + `<span class="picker-row__trait ${H.pk} nw" style="border-style:dashed">a partir de Maduro: ${MAT[k].first}</span>`; if (taken === k) r.style.opacity = '.45'; return r.outerHTML; };
  root.querySelector('.picker-results').innerHTML = mkRow('urso', 'Bear', ['animal', 'Pequeno']) + mkRow('antilope', 'Antelope', ['animal', 'Médio', 'montaria']) + `<div class="picker-row ${H.pk}" style="opacity:.5;border-style:dashed"><span class="picker-row__rank ${H.pk}">+</span><div class="picker-row__main ${H.pk}"><div class="picker-row__name ${H.pk}"><span class="picker-row__name-text ${H.pk}">Mais tipos</span> <span class="picker-row__name-en ${H.pk}">o pack é extensível: novos tipos aparecem aqui sozinhos (D-B01)</span></div></div></div>`;
  const k = S.t1sel; const c = COMP[k];
  const side = root.querySelector('.picker-modal__side .details-panel');
  side.querySelector('.details-panel__name').textContent = c.name;
  side.querySelector('.details-panel__name-en').textContent = k === 'urso' ? 'Bear · jovem' : 'Antelope · jovem';
  side.querySelector('.details-panel__rank').textContent = '3';
  side.querySelector('.details-panel__traits').innerHTML = ['animal', c.size, ...(k === 'antilope' ? ['montaria'] : [])].map((t) => `<span class="details-panel__trait ${H.dp}">${t}</span>`).join('');
  side.querySelector('.details-panel__description').innerHTML = `<p><b>PV</b> ${c.hp} · <b>CA</b> ${c.ac} · <b>Fort/Refl/Von</b> ${c.saves.join('/')} · <b>Desloc.</b> ${c.speed} pés. Todos derivados do tipo, do estágio (jovem) e do nível 3 do dono.</p><p><b>Golpes:</b> ${c.strikes.map((s) => `${s[0]} ${s[1]} ${s[2]} ${s[3]}`).join(' · ')}</p><p><b>Perícias:</b> ${c.skills.map((s) => s[0]).join(', ')}. <b>Sentidos:</b> ${c.senses}.</p><p><b>Apoio:</b> ${c.apoio}</p><div class="pn-card pn-card--comp nw" data-note="D-B14" style="margin-top:6px"><b>A partir de Maduro</b> <span class="pn-hint">ainda indisponível</span><p style=\"margin:3px 0\"><b>Maduro:</b> ${MAT[k].m}</p><p style=\"margin:3px 0\">${MAT[k].n}</p><p style=\"margin:3px 0\">${MAT[k].s}</p><p style=\"margin:3px 0\">${MAT[k].i}</p></div>`;
  const [cancel, ok] = root.querySelectorAll('.picker-modal__actions button');
  cancel.setAttribute('data-set', which === 1 ? 't1pick=closed' : 't1pick2=closed');
  ok.setAttribute('data-set', which === 1 ? 't1pick=' + k : 't1pick2=chosen');
  if (taken === k) ok.setAttribute('disabled', '');
  root.querySelector('.picker-modal__close').setAttribute('data-set', which === 1 ? 't1pick=closed' : 't1pick2=closed');
  root.querySelector('.picker-modal__note').textContent = 'Dados mecânicos derivados no servidor (clean-room)';
  root.style.position = 'absolute'; root.classList.add('nw'); root.setAttribute('data-note', 'D-B01');
  return root.outerHTML;
}

/* chat rows (T5): real message markup; header, alias colour and nested roll copied from the real rows */
function chatRow(time, alias, color, title, body, o = {}) {
  const m = H.msg;
  return `<div class="chat-log__row"><div role="listitem" class="msg msg--text ${m} msg--sys${o.cls || ''}" style="border-left-color:${color}"><div class="msg__header ${m}"><span class="msg__time ${m}">${time}</span> <span class="msg__alias ${m}" style="color:${color}">${alias}</span>${o.sub ? ` <span class="pn-hint">${o.sub}</span>` : ''}</div> <p class="msg__content ${m}">${title}</p>${body}</div></div>`;
}
const FIXDMG = new RegExp('<div class="ability-card__damage [^"]*">([^<]*)<span class="ability-card__dtype [^"]*">([^<]*)</span></div>', 'g');
const fixDmg = (inner) => inner.replace(FIXDMG, (m, a, b) => `<div class="ability-card__damage ${H.ab}" style="font-family:inherit;font-size:12.5px">${a}</div><div class="pn-hint" style="padding:0 0 4px">${b}</div>`);
const ab = (icon, title, inner0, acts = '', k = '') => { const inner = fixDmg(inner0); return `<div class="ability-card ${H.ab}" aria-label="${title}"><div class="ability-card__header ${H.ab}"><span aria-hidden="true" class="ability-card__icon ${H.ab}${k ? ' ability-card__icon--' + k : ''}">${icon}</span> <span class="ability-card__title ${H.ab}">${title}</span></div>${inner}${acts ? `<div class="ability-card__actions ${H.ab}">${acts}</div>` : ''}</div>`; };
const nested = (label, br, total, crit) => `<div class="nested ${H.msg}" role="group"><div class="nested-roll ${H.msg}"><span class="nested-roll__label ${H.msg}">${label}</span> <span class="nested-roll__breakdown ${H.msg}">${br}</span> <span class="nested-roll__total nested-roll__total--${crit ? 'crit' : 'normal'} ${H.msg}">${total}</span></div></div>`;
const effBox = (html, k = 'comp') => `<div class="pn-card pn-card--${k} nw" style="margin:6px 0 0;font-size:11.5px">${html}</div>`;
function t5log() {
  const red = 'rgb(229, 97, 97)', green = '#6fcf97';
  const crit = S.t5deg === 'critico';
    const r1 = chatRow('14:02', 'Bhrotto Raiz-funda', red, 'Caçar Presa',
    ab('◎', 'Caçar Presa', `<div class="ability-card__damage ${H.ab}">Marca aplicada no token<span class="ability-card__dtype ${H.ab}">a marca anterior (nenhuma) foi solta</span></div><div class="ability-card__traits ${H.ab}"><span class="ability-card__trait ${H.ab}">1 ação</span><span class="ability-card__trait ${H.ab}">Presa</span></div>`) +
    nested('Rememorar Conhecimento (Natureza)', '[18] + 9 + 2', '29', true) +
    effBox('<b>Caçador de Monstros:</b> +1 circunstância no próximo ataque contra a presa. Efeito aplicado em Bhrotto Raiz-funda. <span class="pn-badge pn-badge--warn">some depois da rolagem</span>', 'prey'), { cls: ' nw', });
  const r2 = chatRow('14:03', 'Bhrotto Raiz-funda', red, 'Bhrotto comanda o Urso jovem',
    ab('🐾', 'Comandar um Animal', `<div class="ability-card__damage ${H.ab}">Gasta 1 ação<span class="ability-card__dtype ${H.ab}">o Urso jovem age com 2 ações até o fim deste turno</span></div>`, `<button type="button" class="ability-card__btn ${H.ab} ability-card__btn--ok" data-goto="t2" data-set="t2sheet=urso">Abrir ficha do Urso</button>`));
  const r3 = chatRow('14:03', 'Urso jovem', green, 'Apoio aplicado em Bhrotto Raiz-funda',
    ab('✦', 'Apoio do Urso', `<div class="ability-card__damage ${H.ab}">+1d8 cortante<span class="ability-card__dtype ${H.ab}">em cada Golpe do dono que acerte criatura no alcance do Urso (aqui, a presa)</span></div>`) +
    `<div style="margin-top:6px"><span class="pn-badge pn-badge--warn">expira no início do próximo turno de Bhrotto</span></div>`, { sub: 'de Bhrotto' });
  const r4 = chatRow('14:04', 'Bhrotto Raiz-funda', red, 'Mangual de Guerra (MAP 0) contra a presa',
    ab('⚔', 'Mangual de Guerra', `<div class="ability-card__damage ${H.ab}">2d10+4<span class="ability-card__dtype ${H.ab}">+ 1d8 cortante (Apoio)</span></div><div class="ability-card__traits ${H.ab}"><span class="ability-card__trait ${H.ab}">desarmar</span><span class="ability-card__trait ${H.ab}">varredura</span><span class="ability-card__trait ${H.ab}">derrubar</span> <span class="pn-badge pn-badge--prey">Presa</span></div>`, `<button type="button" class="ability-card__btn ${H.ab} ability-card__btn--danger">Rolar dano</button> <button type="button" class="ability-card__btn ${H.ab} ability-card__btn--danger">Rolar dano crítico</button>`, 'strike') +
    nested('Mangual de Guerra (MAP 0)', `[${crit ? 20 : 15}] + 9 + 1`, crit ? '30' : '25', crit) +
    `<ul class="pn-mods nw" data-note="D-B05" style="margin:6px 0"><li><span>Base (nível 3 + treinado + FOR)</span><b>+9</b></li><li><span>Caçador de Monstros <i>(consumido)</i></span><b>+1</b></li><li><span>Alcance Prênsil</span><b>desligado</b></li><li><span>Apoio do Urso <i>(presa no alcance)</i></span><b>+1d8 S</b></li></ul>` +
    nested('Dano', crit ? '(2d10 [7,6] + 4 + 1d8 [5]) × 2' : '2d10 [7,6] + 4 + 1d8 [5]', crit ? '44' : '22', crit) +
    `<div class="ability-card__actions ${H.ab}" style="margin-top:6px"><button type="button" class="ability-card__btn ${H.ab} ability-card__btn--ok">Aplicar dano à presa</button> <button type="button" class="ability-card__btn ${H.ab}">Meio dano</button></div>`);
  return r1 + r2 + r3 + r4;
}

/* map overlays (T4): coordinates are in the 1200x902 canvas capture (token centres of the real tokens) */
const BG = (src) => `<img src="${src}" alt="" style="position:absolute;left:0;top:0;width:1200px;height:902px;display:block">`;
const mapKey = () => (S.comp === 'urso' ? 'a' : S.moved ? 'c' : 'b');
function mapOv(view) {
  const gm = view === 'gm'; const k = mapKey(); let h = '';
  const OB = { x: 812, y: 486 };
  const an = k === 'c' ? { x: 648, y: 596 } : { x: 428, y: 760 };
  const label = (t) => `<span class="tk__l">${t}</span>`;
  if (S.comp === 'antilope') {
    if (S.moved) h += `<div class="ghost"></div>`.replace('class="ghost"', `class="ghost" style="left:428px;top:760px"`) + `<svg style="position:absolute;left:0;top:0" width="1200" height="902"><line x1="428" y1="760" x2="${an.x}" y2="${an.y}" stroke="rgba(255,255,255,.4)" stroke-width="2" stroke-dasharray="6 6"/></svg><span class="ov-note" style="left:${(428 + an.x) / 2 + 8}px;top:${(760 + an.y) / 2 - 16}px">4 casas · 20 pés de 40</span>`;
    if (mountedOn()) {
      h += `<div class="tk tk--self tk--sm nw" style="left:${an.x + 17}px;top:${an.y - 17}px">B</div>`;
      h += `<div class="ov-chip nw" style="left:${an.x + 40}px;top:${an.y - 60}px"><span class="ov-badge" style="color:var(--fusion-danger);border-color:var(--fusion-danger)">Reflexos −2</span><span class="ov-badge" style="color:#ffc857;border-color:#ffc857">MAP compartilhado</span></div>`;
    } else {
      h += `<div class="tk tk--self nw" style="left:${an.x + 62}px;top:${an.y}px">B${label(gm ? 'Bhrotto Raiz-funda' : 'Bhrotto')}</div>`;
    }
  }
  if (S.prey === 'ogro') h += `<div class="nw" style="position:absolute;left:${OB.x}px;top:${OB.y}px"><span class="ptag" style="left:15px;top:-38px;right:auto">◆ PRESA</span></div>`;
  if (S.target === 'ogro') h += `<div class="ret nw" style="left:${OB.x}px;top:${OB.y}px"><i></i><i></i><i></i><i></i></div>`;
  if (gm) {
    h += `<div class="tk tk--gm nw" style="left:1010px;top:300px;width:76px;height:76px;margin:-38px 0 0 -38px;font-size:14px">GM${label('Gigante da Colina (oculto aos jogadores)')}</div>`;
    h += `<span class="ov-note nw" style="left:12px;bottom:12px">${S.comp === 'antilope' ? 'Urso jovem: em espera (sem token). ' : ''}rastro do cavaleiro = rastro da montaria</span>`;
  } else if (S.comp === 'antilope') {
    h += `<span class="ov-note" style="left:12px;bottom:12px">rastro do cavaleiro = rastro da montaria</span>`;
  }
  h += `<span class="ov-note" style="left:100px;top:12px;border:1px solid var(--fusion-border)">${gm ? 'visão do Mestre' : 'visão do jogador'}</span>`;
  return h;
}

/* inventory (T6) */
function t6weapon() {
  const tags = (S.pot ? `<span class="pn-badge pn-badge--ok">+${S.pot}</span> ` : '') + (S.stk ? `<span class="pn-badge pn-badge--ok">${LBL[S.stk]}</span>` : '') + (!S.pot && !S.stk ? '<span class="pn-badge">sem runas</span>' : '');
  return `<img class="inventory-row__icon ${H.sh}" src="${PX}" alt="" width="24" height="24" aria-hidden="true"><span class="inventory-row__name ${H.sh}">Mangual de Guerra <span class="nw">${tags}</span><br><span class="pn-hint">ataque ${fmt(9 + S.pot)} · dano ${1 + S.stk}d10+4 concussão · 2 mãos · desarmar, varredura, derrubar</span></span><span class="inventory-row__qty ${H.sh}">×1</span><span class="inventory-row__bulk ${H.sh}">Volume 2</span><button type="button" class="inventory-row__equip inventory-row__equip--on ${H.sh}" aria-pressed="true">Equipado</button><button type="button" class="inventory-row__equip ${H.sh} nw" data-flip="t6open" data-note="D-B06" style="${S.t6open ? 'border-color:var(--fusion-accent);color:var(--fusion-accent-hover)' : ''}">${S.t6open ? 'Fechar runas' : 'Runas'}</button>`;
}
function t6editor() {
  const opts = ['', 'Flamejante', 'Gélida', 'Toque Fantasmagórico', 'Dolorosa', 'Afiada', 'Trovejante'].map((o) => `<option value="${o}">${o || 'vazio'}</option>`).join('');
  const slots = [0, 1, 2].map((i) => i < S.pot ? `<div class="pn-row"><span class="pn-hint" style="width:60px">Espaço ${i + 1}</span><select class="pn-input" data-prop="${i}">${opts.replace(`value="${S.props[i]}"`, `value="${S.props[i]}" selected`)}</select></div>` : `<div class="pn-row pn-off"><span class="pn-hint" style="width:60px">Espaço ${i + 1}</span><span class="pn-hint">sem espaço</span></div>`).join('');
  return `<div style="flex:1;display:flex;flex-direction:column;gap:8px;padding:6px 8px;border:1px solid var(--fusion-border);border-radius:var(--fusion-radius-sm,4px);background:var(--fusion-surface-alt)">
<div class="pn-row" style="align-items:flex-start"><b style="font-size:12px;width:110px">Potência</b><div><span class="pn-seg">${[0, 1, 2, 3].map((n) => `<button class="${S.pot === n ? 'on' : ''}" data-set="pot=${n}">${n ? '+' + n : 'Nenhuma'}</button>`).join('')}</span><div class="pn-hint" style="margin-top:3px">+${S.pot} nas jogadas de ataque</div></div></div>
<div class="pn-row" style="align-items:flex-start"><b style="font-size:12px;width:110px">Runa de ataque</b><div><span class="pn-seg" style="flex-wrap:wrap">${['Nenhuma — 1 dado (1d10)', 'Runa de ataque — 2 dados (2d10)', 'Runa de ataque maior — 3 dados (3d10)', 'Runa de ataque suprema — 4 dados (4d10)'].map((n, i) => `<button class="${S.stk === i ? 'on' : ''}" data-set="stk=${i}">${n}</button>`).join('')}</span></div></div>
<div><b style="font-size:12px">Runas de propriedade</b> <span class="pn-hint">(${S.pot} ${S.pot === 1 ? 'espaço' : 'espaços'}, igual à Potência)</span><div style="display:flex;flex-direction:column;gap:5px;margin-top:5px">${slots}</div></div>
<div class="pn-card pn-card--comp"><b>Preview:</b> ataque ${fmt(9 + S.pot)}, dano ${1 + S.stk}d10+4 concussão, crítico (${1 + S.stk}d10+4)×2 · armadura: sem runas na v1 do editor</div></div>`;
}
function t6wallet() {
  const ro = 'readonly';
  const coin = (l, t, v) => `<label class="wallet__coin ${H.sh}" title="${t}"><span class="wallet__coin-label ${H.sh}">${l}</span> <input class="wallet__input ${H.sh}" type="number" ${ro} value="${v}" aria-label="${t}"></label>`;
  return `<h3 class="wallet__title ${H.sh}">Carteira</h3><div class="wallet__coins ${H.sh}">${coin('pl', 'Platina', 0)}${coin('po', 'Ouro', 2)}${coin('pp', 'Prata', 0)}${coin('pc', 'Cobre', 0)}</div><p class="wallet__total ${H.sh}">Total: 2 po</p><p class="wallet__hint ${H.sh}">Comprar um item não desconta da carteira. <span class="nw" data-note="D-B13">Só o Mestre ajusta o saldo (com motivo).</span></p>${S.t6view === 'mestre' ? `<div class="pn-row nw" style="margin-top:6px" data-note="D-B13">${badge('só o Mestre', 'gm')} <button type="button" class="pn-btn" data-flip="t6wallet">Ajustar carteira</button><span class="pn-hint">sem regra automática de riqueza por nível (D-B13)</span></div>` : ''}`;
}
function t6modal() {
  if (!(S.t6wallet && S.t6view === 'mestre')) return '';
  const root = tpl(TPL.pickerBackdrop);
  root.querySelector('.picker-modal').style.cssText = 'max-width:520px;height:auto;max-height:none;margin:auto';
  root.querySelector('.picker-modal__title').textContent = 'Ajustar carteira de Bhrotto Raiz-funda';
  const body = root.querySelector('.picker-modal__body');
  body.innerHTML = `<div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;width:100%"><div class="pn-row">${badge('só o Mestre', 'gm')} <span class="pn-hint">atual: 2 po</span></div><div class="pn-row"><span class="pn-hint">pl</span><input class="pn-input" style="width:64px;text-align:right" value="0"><span class="pn-hint">po</span><input class="pn-input" style="width:64px;text-align:right" value="15"><span class="pn-hint">pp</span><input class="pn-input" style="width:64px;text-align:right" value="0"><span class="pn-hint">pc</span><input class="pn-input" style="width:64px;text-align:right" value="0"></div><div><div class="pn-hint" style="margin-bottom:3px">Motivo (obrigatório)</div><input class="pn-input" style="width:100%" value="Riqueza de nível 3 (tabela de mesa)"></div></div>`;
  root.querySelector('.picker-modal__note').textContent = 'grava no registro da ficha: quem, quando, motivo';
  const [c, o] = root.querySelectorAll('.picker-modal__actions button');
  c.setAttribute('data-flip', 't6wallet'); o.setAttribute('data-flip', 't6wallet'); o.textContent = 'Aplicar';
  root.querySelector('.picker-modal__close').setAttribute('data-flip', 't6wallet');
  root.style.position = 'absolute'; root.classList.add('nw'); root.setAttribute('data-note', 'D-B13');
  return root.outerHTML;
}

/* Plano (T1) */
const seal = {
  bad: () => sealOb('inelegível: herança crisântemo', 'bad'),
};
const R = {
  mapBgSheet: () => BG(MAPS.plb),
  mapBgGmS: () => BG(MAPS.gmb),
  mapBgPl: () => BG(MAPS['pl' + mapKey()]),
  mapBgGm: () => BG(MAPS['gm' + mapKey()]),
  mapOvPl: () => mapOv('pl'),
  mapOvGm: () => mapOv('gm'),
  t1viewbadge: () => (S.t1view === 'mestre' ? ' <span class="pn-badge pn-badge--gm nw">visão do Mestre</span>' : ''),
  t1sub1: () => {
    const p = S.t1pick;
    if (p === 'closed') return `<button type="button" class="plan-empty-slot ${H.pe}" data-set="t1pick=open">Escolher companheiro…</button>`;
    if (p === 'open') return `<button type="button" class="plan-empty-slot ${H.pe}" data-set="t1pick=closed">Escolhendo o companheiro… (cancelar)</button>`;
    return planSlot(NAME[p], '', 'Companheiro animal', 'Animal Companion', { seal: ' ' + sealOb('ligado a Bhrotto'), edit: 'ⓘ', attrs: `data-goto="t2" data-set="t2sheet=${p}" title="Abrir a ficha de ${NAME[p]}"`, remove: ['data-set="t1pick=open"', 'Trocar tipo'] });
  },
  t1sub2: () => {
    const p = S.t1pick2;
    if (p === 'closed') return `<button type="button" class="plan-empty-slot ${H.pe}" data-set="t1pick2=open">Escolher o 2º companheiro…</button>`;
    if (p === 'open') return `<button type="button" class="plan-empty-slot ${H.pe}" data-set="t1pick2=closed">Escolhendo o 2º companheiro… (cancelar)</button>`;
    const k = S.t1pick === 'antilope' ? 'urso' : 'antilope';
    return planSlot(NAME[k], '', 'Companheiro animal · em espera', 'Chamar Companheiro: exploração, 1 minuto', { seal: ' ' + sealOb('em espera'), edit: 'ⓘ', attrs: `data-goto="t2" data-set="t2sheet=${k}"`, remove: ['data-set="t1pick2=open"', 'Trocar tipo'] });
  },
  t1nbslot: () => {
    if (S.t1gm) return planSlot('Floração Nobre', 'Noble Bloom', 'Talento Geral', 'General Feat', { seal: ' ' + sealOb('liberado pelo Mestre', 'gm') + ' <span class="pn-hint">exceção registrada: Acesso dispensado</span>', style: 'border-color:#5fb3d9', remove: ['', 'Floração Nobre'] });
    return planSlot('Floração Nobre', 'Noble Bloom', 'Talento Geral', 'General Feat', { seal: ' ' + sealOb('inelegível: herança crisântemo', 'bad') + (S.t1view === 'jogador' ? ' <button type="button" class="pn-link">Pedir liberação ao Mestre</button>' : ''), check: '!', checkStyle: 'color:var(--fusion-danger)', style: 'border-color:var(--fusion-danger);background:var(--fusion-danger-dim)', remove: ['', 'Floração Nobre'] });
  },
  t1gmcard: () => `<div class="level-card__header ${H.lc}">Exceções de elegibilidade ${badge('só o Mestre vê', 'gm')}</div><div class="level-card__body ${H.lc}"><div class="level-card__slot ${H.lc}"><div class="pn-card pn-card--gm"><div class="pn-row"><b>Floração Nobre</b> <span class="pn-hint">Bhrotto · motivo:</span><span class="pn-mono" style="font-size:11.5px">"Acesso crisântemo dispensado por decisão de mesa"</span></div><div class="pn-row" style="margin-top:6px"><span class="pn-sp"></span>${S.t1gm ? '<button class="pn-btn" data-flip="t1gm">Revogar exceção</button>' : '<button class="pn-btn pn-btn--primary" data-flip="t1gm">Liberar exceção</button>'}</div></div></div></div>`,
  t1picker,
  t2sheet: npcSheet,
  t2title: () => COMP[S.t2sheet].name + ' (npc)',
  t3top: fnT3.top, t3strike: fnT3.strike, t3after: fnT3.after, t3ac: fnT3.ac, t3ref: fnT3.ref, t3titlechip: fnT3.chip,
  t5log,
  t6weapon, t6editor, t6wallet, t6modal,
};

/* ------------------------------------------------------------------ frames */
const FR = {};
function applyDoc(doc) {
  doc.querySelectorAll('[data-fn]').forEach((el) => {
    const f = R[el.dataset.fn]; if (!f) return;
    const h = f(el); if (h !== undefined) el.innerHTML = h;
  });
  doc.querySelectorAll('[data-when]').forEach((el) => { el.hidden = !holds(el.dataset.when); });
}
function render() {
  document.querySelectorAll('[data-screen]').forEach((el) => {
    if (el.tagName === 'SECTION') el.hidden = el.dataset.screen !== S.screen;
    else el.classList.toggle('on', el.dataset.screen === S.screen);
  });
  applyDoc(document);
  Object.values(FR).forEach((fr) => { if (fr.contentDocument && fr.contentDocument.body) applyDoc(fr.contentDocument); });
  document.querySelectorAll('.states [data-set]').forEach((el) => { const [k, v] = el.dataset.set.split('='); el.classList.toggle('on', String(S[k]) === (v === '1' ? 'true' : v === '0' ? 'false' : v)); });
  document.querySelectorAll('.states [data-flip]').forEach((el) => el.classList.toggle('on', !!S[el.dataset.flip]));
  fit();
}
function fit() {
  const on = document.getElementById('tgFit').checked;
  const k = on ? Math.min(1, (window.innerWidth - 34) / 1500) : 1;
  document.querySelectorAll('.fw').forEach((fw) => {
    fw.style.zoom = k;
  });
}
function flags() {
  const n = document.getElementById('tgNew').checked, m = document.getElementById('tgNotes').checked;
  Object.values(FR).forEach((fr) => { const r = fr.contentDocument && fr.contentDocument.documentElement; if (r) { r.classList.toggle('show-new', n); r.classList.toggle('show-notes', n && m); } });
  document.body.classList.toggle('hide-notes', !m);
}
function onClick(e) {
  if (!e.target.closest('.cs-chip') && S.csOpen) { S.csOpen = null; render(); flags(); }
  const cs = e.target.closest('[data-cs]'); if (cs) { S.csOpen = S.csOpen === cs.dataset.cs ? null : cs.dataset.cs; render(); flags(); return; }
  const t = e.target.closest('[data-set],[data-flip],[data-goto],[data-act]'); if (!t || t.disabled) return;
  if (t.dataset.set) { const [k, v] = t.dataset.set.split('='); setVal(k, v); }
  if (t.dataset.flip) { const k = t.dataset.flip; S[k] = !S[k]; if (k === 'mounted' && S.mounted) S.comp = 'antilope'; if (k === 'support') S.supportFrom = S.comp; if (k === 'mh' && S.prey === 'none') S.mh = false; }
  if (t.dataset.goto) S.screen = t.dataset.goto;
  const a = t.dataset.act;
  if (a === 'hunt' && S.target !== 'none') { S.prey = S.target; S.log = `Caçar Presa: ${TG[S.target].n} marcado como Presa.`; }
  if (a === 'recall') { S.mh = true; S.log = 'Rememorar Conhecimento: sucesso crítico. Caçador de Monstros +1 ativo.'; if (S.prey === 'none') S.mh = false; }
  if (a === 'apoio' && S.cmd) { S.support = true; S.supportFrom = S.t2sheet; }
  if (a === 'roll') { const c = t3calc(), d = 1 + Math.floor(Math.random() * 20), isPrey = S.target !== 'none' && S.prey === S.target; S.log = `Mangual de Guerra: 1d20 [${d}] ${fmt(c.atk)} = ${d + c.atk}` + (S.mh && isPrey ? ' · Caçador de Monstros consumido' : ''); if (S.mh && isPrey) S.mh = false; }
  render(); flags();
}
function mount() {
  const css = document.getElementById('app-css').textContent + '\n' + document.getElementById('extra-css').textContent;
  document.querySelectorAll('iframe[data-body]').forEach((fr) => {
    FR[fr.dataset.body] = fr;
    const doc = fr.contentDocument; doc.open();
    doc.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + document.getElementById('body-' + fr.dataset.body).textContent + '</body></html>');
    doc.close();
    doc.addEventListener('click', onClick);
    doc.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.prop !== undefined) { S.props[+e.target.dataset.prop] = e.target.value; render(); flags(); } });
  });
}
document.addEventListener('click', (e) => {
  const sw = e.target.closest('#switcher button');
  if (sw) { S.screen = sw.dataset.screen; render(); flags(); return; }
  if (e.target.closest('[data-set],[data-flip],[data-goto],[data-act]')) onClick(e);
});
['tgNew', 'tgNotes'].forEach((id) => document.getElementById(id).addEventListener('change', flags));
document.getElementById('tgFit').addEventListener('change', fit);
window.addEventListener('resize', fit);
mount(); render(); flags();
