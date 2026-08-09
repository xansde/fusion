/**
 * @fusion/system-pf2e — Isekai variant: the eight archetypes.
 *
 * Transcribed from the table's source material (draft v1, 2026-08-08).
 * Player-facing text is pt-BR verbatim; only the structure is ours.
 *
 * WHAT BECOMES AN `action`, and what stays a blessing:
 *   - it costs an action, a reaction or a free action  → action
 *   - it costs Focus                                    → action
 *   - it is the Major Blessing's central VERB (Construir, Coletar, gastar um
 *     Dado do Destino)                                  → action
 *   - anything else (a flat passive, a permanent build change, a downtime
 *     project) stays a Minor Blessing and shows only in the Plan column.
 * The Isekai tab answers "what can I spend right now"; a passive bonus is not
 * an answer to that question, and listing it would bury the ones that are.
 *
 * Clean-room: original table design over ORC/OGL PF2e Remaster rules.
 */

import type { IsekaiArchetype } from "./types.js";

const CARISMATICO: IsekaiArchetype = {
  id: "carismatico",
  name: "O CARISMÁTICO",
  axis: "EIXO SOCIAL E DE COMANDO",
  tagline: "Eu nunca luto sozinho.",
  color: "#a05fbf",
  revokes: "A fraqueza do subsistema social e o 'você é só um numa party'.",
  inspirations: "Rimuru (Tensura) · Ainz (Overlord) · Issei (DxD)",
  majorBlessing: {
    title: "O Séquito",
    paragraphs: [
      "<b>A Base (ilimitada):</b> todos os companions leais a você — sua nação, guilda, matilha ou harém. Vivem livres das obrigações, mas atendem ao seu chamado.",
      "<b>O Séquito (até 5):</b> os que te acompanham agora; cada um é uma criatura de nível (seu − 2) que evolui com você. Fora de combate, Libere alguém pra Base ou Convoque alguém de volta — sem recrutar de novo.",
      "<b>Em batalha (até 3):</b> quantos lutam por vez. <b>Comando:</b> gaste 1 ação sua e um companion ativo faz 2 ações — suas ações são o limite de quantos agem por turno.",
    ],
  },
  minorBlessings: [
    {
      level: 1,
      name: "Subjugar",
      text: "Gaste 1 Foco pra recrutar pro séquito um inimigo que você derrotou ou convenceu. Se o séquito de 5 estiver cheio, ele vai pra Base.",
    },
    {
      level: 1,
      name: "Presença Inspiradora",
      text: "Aliados e companions a 30 ft de você ficam imunes a medo e charme.",
    },
    {
      level: 3,
      name: "Enviar para Missão",
      text: "Em downtime, despache companions da Base em missões paralelas que rendem recursos, itens ou poderes especiais; recompensa e risco escalam com o tempo investido.",
    },
    {
      level: 4,
      name: "Dar um Nome",
      text: "Nomeie um companion: ele vira nível igual ao seu e ganha uma habilidade. Cada nomeado em batalha trava 1 Ponto de Foco do seu máximo (não gasta nem recarrega) enquanto lutar com você.",
    },
    {
      level: 6,
      name: "Rodízio",
      text: "Gaste 1 Foco pra trocar um companion ativo por um da reserva no meio da batalha (seus 5 em rodízio nos 3 slots).",
    },
    {
      level: 8,
      name: "Lealdade Inquebrável",
      text: "Seus companions tratam qualquer save de Vontade como sucesso crítico (imunes a charme, medo, controle e dominação). Gaste 1 Foco pra manter um companion caído com 1 HP.",
    },
    {
      level: 12,
      name: "Exército Pessoal",
      text: "1x por encontro, gaste 1 Foco: todo o séquito ativo age com ações completas próprias nesse turno, sem você gastar nada.",
    },
  ],
  panels: [
    {
      title: "VOCÊ DEVIA TER FICADO DO MEU LADO",
      subtitle: "AÇÃO ATIVA · 1 ação · custa 2 Foco",
      paragraphs: [
        "Um inimigo que te vê faz um save de Vontade ou, por 1 rodada, para de te atacar e luta ao seu lado. O protagonista que converte o vilão pela conversa.",
      ],
    },
    {
      title: "RECARGA DE FOCO",
      paragraphs: [
        "Refocus padrão (10 min): recupera 1 Ponto de Foco, como no PF2e.",
        "Em jogo: recupere 1 Foco quando você tem sucesso numa ação social contra um inimigo em combate (Demoralize, Make an Impression, Bon Mot, Feint), gastando a ação — 1x por criatura por encontro.",
      ],
    },
  ],
  actions: [
    {
      id: "comando",
      name: "Comando",
      level: 1,
      cost: "1",
      focus: 0,
      text: "Gaste 1 ação sua e um companion ativo faz 2 ações. Suas ações são o limite de quantos agem por turno.",
      origin: "major",
    },
    {
      id: "voce-devia",
      name: "Você Devia Ter Ficado do Meu Lado",
      level: 1,
      cost: "1",
      focus: 2,
      text: "Um inimigo que te vê faz um save de Vontade ou, por 1 rodada, para de te atacar e luta ao seu lado.",
      origin: "panel",
    },
    {
      id: "subjugar",
      name: "Subjugar",
      level: 1,
      cost: "none",
      focus: 1,
      text: "Recrute pro séquito um inimigo que você derrotou ou convenceu. Se o séquito de 5 estiver cheio, ele vai pra Base.",
      origin: "minor",
    },
    {
      id: "rodizio",
      name: "Rodízio",
      level: 6,
      cost: "none",
      focus: 1,
      text: "Troque um companion ativo por um da reserva no meio da batalha (seus 5 em rodízio nos 3 slots).",
      origin: "minor",
    },
    {
      id: "segurar-caido",
      name: "Lealdade Inquebrável — segurar um caído",
      level: 8,
      cost: "none",
      focus: 1,
      text: "Mantenha um companion caído com 1 HP.",
      origin: "minor",
    },
    {
      id: "exercito-pessoal",
      name: "Exército Pessoal",
      level: 12,
      cost: "none",
      focus: 1,
      frequency: "1x por encontro",
      text: "Todo o séquito ativo age com ações completas próprias nesse turno, sem você gastar nada.",
      origin: "minor",
    },
  ],
  tracker: {
    kind: "roster",
    id: "retinue",
    title: "O Séquito",
    tiers: [
      { id: "active", label: "Em batalha", cap: 3 },
      { id: "retinue", label: "Séquito (acompanha)", cap: null },
      { id: "base", label: "Base", cap: null },
    ],
    followingCap: 5,
    namedFromLevel: 4,
    namedLocksFocus: true,
    note: "Base ilimitada; até 5 acompanham; até 3 lutam por vez. Cada ★ Nomeado trava 1 do seu Foco máximo.",
  },
};

const CRAFTER: IsekaiArchetype = {
  id: "crafter",
  name: "O CRAFTER",
  axis: "EIXO DE CRIAÇÃO E TECNOLOGIA",
  tagline: "Se não existe neste mundo, eu construo.",
  color: "#c8772e",
  revokes: "A riqueza/itens por nível e a fronteira tecnológica do mundo.",
  inspirations: "Myne (Bookworm) · Ernesti (Knights & Magic) · Senku (Dr. Stone)",
  majorBlessing: {
    title: "A Forja Impossível",
    paragraphs: [
      "<b>Catálogo Sem Fronteiras:</b> você fabrica itens de qualquer sistema ou realidade — PF2e, Starfinder 2e (armas de energia, augmentations, gadgets) e além. Pros NPCs, é só magia estranha (Clarke's Law).",
      "<b>Sem Gargalos:</b> você ignora os freios normais de Craft — fórmula, tempo longo, custo em ouro. Você simplesmente sabe como fazer.",
      "<b>Construir:</b> gaste 1 Essência de Monstro [Nv X] pra fabricar qualquer item de nível X ou menor.",
    ],
  },
  minorBlessings: [
    {
      level: 1,
      name: "Salvar",
      text: "Reação: quando uma criatura cai perto de você, extraia na hora 1 Essência [Nv dela] e recupere 1 Foco.",
    },
    {
      level: 1,
      name: "Desmontar",
      text: "Quebre um item de nível X pra obter 1 Essência de nível igual à metade de X (arredondado pra baixo).",
    },
    {
      level: 3,
      name: "Oficina de Campo",
      text: "Gaste 1 Foco e 1 ação pra fabricar 1 item na hora, no meio da ação — em vez de levar tempo.",
    },
    {
      level: 4,
      name: "Aprimoramentos",
      text: "Instale augmentations cibernéticas (SF2e) ou forje runas e encantamentos permanentes (medieval) em você e em aliados.",
    },
    {
      level: 6,
      name: "Linha de Produção",
      text: "Sua Oficina de Campo passa a criar 1 cópia do item pra cada aliado de uma vez (custa 2 Foco).",
    },
    {
      level: 8,
      name: "Engenhoca de Guerra",
      text: "Construa drones, torres e armadilhas autônomas que agem por conta própria.",
    },
    {
      level: 12,
      name: "Maravilha",
      text: "Construa algo lendário e único: um mecha, uma fortaleza móvel ou uma arma de cerco.",
    },
  ],
  minorsNote: "A trilha do Crafter — cada uma é ganha ao atingir o nível indicado.",
  panels: [
    {
      title: "AS ESSÊNCIAS DE MONSTRO",
      subtitle: "O material — colete (Salvar), sintetize, construa",
      paragraphs: [
        "<b>Síntese:</b> 2 Essências [Nv N] se combinam em 1 Essência [Nv N+1], na sua oficina.",
        "<b>A conta:</b> um item de nível 20 custa 1 Essência [Nv 20] — ou 2 de [Nv 19], ou 4 de [Nv 18], dobrando a cada nível abaixo. Por isso itens poderosos exigem caçar presas à altura; fundir bichos fracos vira exponencial — e isso auto-balanceia o sistema.",
        "Itens de sistemas não-compatíveis com d20 precisam de aprovação ou adaptação do GM.",
      ],
    },
    {
      title: "RECARGA DE FOCO",
      paragraphs: [
        "Refocus padrão (10 min): recupera 1 Ponto de Foco.",
        "Em jogo: via Salvar — +1 Foco por criatura derrubada (1x por rodada). O Foco serve só pra acelerar a criação (Oficina de Campo / Linha de Produção).",
      ],
    },
  ],
  actions: [
    {
      id: "construir",
      name: "Construir",
      level: 1,
      cost: "none",
      focus: 0,
      text: "Gaste 1 Essência de Monstro [Nv X] pra fabricar qualquer item de nível X ou menor, ignorando fórmula, tempo e custo em ouro.",
      origin: "major",
    },
    {
      id: "salvar",
      name: "Salvar",
      level: 1,
      cost: "reaction",
      focus: 0,
      frequency: "1x por rodada (para o Foco)",
      text: "Quando uma criatura cai perto de você, extraia na hora 1 Essência [Nv dela] e recupere 1 Foco.",
      origin: "minor",
    },
    {
      id: "oficina-de-campo",
      name: "Oficina de Campo",
      level: 3,
      cost: "1",
      focus: 1,
      text: "Fabrique 1 item na hora, no meio da ação — em vez de levar tempo.",
      origin: "minor",
    },
    {
      id: "linha-de-producao",
      name: "Linha de Produção",
      level: 6,
      cost: "1",
      focus: 2,
      text: "Sua Oficina de Campo cria 1 cópia do item pra cada aliado de uma vez.",
      origin: "minor",
    },
  ],
  tracker: {
    kind: "stock",
    id: "essences",
    title: "Essências de Monstro",
    unitLabel: "Essência",
    maxLevel: 20,
    fuseRatio: 2,
    note: "Colete (Salvar), funda 2×[Nv N] → 1×[Nv N+1], e gaste 1×[Nv X] pra fabricar um item de nível X ou menor.",
  },
};

const ESPECIALISTA: IsekaiArchetype = {
  id: "especialista",
  name: "O ESPECIALISTA",
  axis: "EIXO DO EDITOR DE REGRAS",
  tagline: "Vocês decoraram as regras. Eu li o código-fonte.",
  color: "#2fa0a8",
  revokes: "As traits e o rank de uma habilidade são fixos — você reescreve os seus.",
  inspirations: "Rudeus (Mushoku Tensei) · Shin (Wise Man's Grandchild) · Tatsuya (Mahouka)",
  majorBlessing: {
    title: "O Editor",
    paragraphs: [
      "<b>Reescrever Traits (Reação):</b> quando você vai usar uma habilidade, ação ou ataque seu, adicione e/ou remova até 2 traits dele — +2, -2, ou +1/-1. Só no que é seu. (Trait = as palavras-chave da habilidade: tipo de dano, execução, propriedades de arma, tradição.)",
      "<b>Heightening:</b> seu nível de heightening é o dobro do seu nível — cantrips e focus spells escalam dobrado (saturam no rank 10 lá pelo nível 10). Gaste 1 Foco pra heightenar uma magia sem gastar o slot. Vale só pra rank — nunca pra acerto, DC ou proficiência.",
      "<b>Habilidade Assinatura:</b> escolha uma habilidade, ação ou arma como Assinatura — nela, uma edição de traits fica permanente, sem gastar reação. Você redefine sua Assinatura a cada dia, nas preparações. Começa com 1.",
    ],
  },
  minorBlessings: [
    {
      level: 1,
      name: "Ensinar a Técnica",
      text: "Ensine uma Assinatura sua a um aliado, que passa a usá-la. Cada aliado que a sabe trava 1 Ponto de Foco do seu máximo enquanto a souber.",
    },
    {
      level: 3,
      name: "Heightening Bruto",
      text: "Sua Assinatura, mesmo que não seja magia, passa a escalar pelo seu nível dobrado — você gere uma coisa só.",
    },
    {
      level: 4,
      name: "Qualquer Trait",
      text: "O Leque Inicial acaba; você passa a editar qualquer trait (o risco é só seu).",
    },
    {
      level: 6,
      name: "Aprimoramento",
      text: "Edita até 3 traits por reação; mantém 2 Assinaturas.",
    },
    {
      level: 8,
      name: "Reescrever o Inimigo",
      text: "Reação, 3 Foco: quando um adversário vai usar uma habilidade ou ataque, adicione ou remova uma trait daquela ação dele — só por aquele turno.",
    },
    {
      level: 12,
      name: "Aprimoramento",
      text: "Edita até 4 traits por reação; mantém 3 Assinaturas.",
    },
  ],
  minorsNote: "A trilha do Editor — cada uma é ganha ao atingir o nível indicado.",
  panels: [
    {
      title: "O LEQUE INICIAL",
      subtitle: "As traits que você pode editar até o nível 4",
      paragraphs: [
        "<b>Tipos de dano</b> — trocar entre fire, cold, electricity, acid, sonic, force, vitality, void, mental, poison e os físicos (bludgeoning/piercing/slashing).",
        "<b>Armas</b> — agile, finesse, reach, thrown, versatile. &nbsp; <b>Natureza</b> — magical, nonlethal.",
        "<b>Execução</b> — verbal, somatic/manipulate (remover = agir calado, amarrado, sem provocar reação). &nbsp; <b>Tradição</b> — arcane, divine, occult, primal.",
      ],
    },
    {
      title: "RECARGA DE FOCO",
      paragraphs: [
        "Refocus padrão (10 min): recupera 1 Ponto de Foco.",
        "Em jogo: +1 Foco quando uma trait que você editou faz sua habilidade contornar uma resistência, imunidade ou defesa do alvo (1x por rodada) — o hack funcionou.",
      ],
    },
  ],
  actions: [
    {
      id: "reescrever-traits",
      name: "Reescrever Traits",
      level: 1,
      cost: "reaction",
      focus: 0,
      text: "Quando você vai usar uma habilidade, ação ou ataque seu, adicione e/ou remova até 2 traits dele (3 no nível 6, 4 no 12). Só no que é seu.",
      origin: "major",
    },
    {
      id: "heightening-livre",
      name: "Heightening sem slot",
      level: 1,
      cost: "none",
      focus: 1,
      text: "Heightene uma magia sem gastar o slot. Vale só pra rank — nunca pra acerto, DC ou proficiência.",
      origin: "major",
    },
    {
      id: "ensinar-a-tecnica",
      name: "Ensinar a Técnica",
      level: 1,
      cost: "none",
      focus: 0,
      frequency: "trava 1 Foco máx. por aliado",
      text: "Ensine uma Assinatura sua a um aliado, que passa a usá-la enquanto a souber.",
      origin: "minor",
    },
    {
      id: "reescrever-o-inimigo",
      name: "Reescrever o Inimigo",
      level: 8,
      cost: "reaction",
      focus: 3,
      text: "Quando um adversário vai usar uma habilidade ou ataque, adicione ou remova uma trait daquela ação dele — só por aquele turno.",
      origin: "minor",
    },
  ],
  tracker: {
    kind: "list",
    id: "signatures",
    title: "Assinaturas",
    placeholder: "habilidade/arma assinatura…",
    capByLevel: [
      { level: 1, cap: 1 },
      { level: 6, cap: 2 },
      { level: 12, cap: 3 },
    ],
    flagLabel: "ensinada a um aliado",
    flagLocksFocus: true,
    note: "Edição de traits permanente na Assinatura. Mantém 1 (2 no nível 6, 3 no 12). Cada ★ ensinada trava 1 do seu Foco máximo.",
  },
};

const EVOLUTIVO: IsekaiArchetype = {
  id: "evolutivo",
  name: "O EVOLUTIVO",
  axis: "EIXO DA EVOLUÇÃO",
  tagline: "Tudo que eu derroto vira parte de mim.",
  color: "#c0388f",
  revokes: "Ancestry fixa e o ritmo de XP — você coleta poderes dos outros e se remonta todo dia.",
  inspirations: "Rimuru (Tensura) · Kumoko (So I'm a Spider) · Rou (Re:Monster)",
  majorBlessing: {
    title: "Predador",
    paragraphs: [
      "<b>Coletar:</b> ao reduzir uma criatura a 0 HP, um teste (DC pelo nível dela) adiciona uma habilidade dela ao seu Catálogo — sua coleção permanente e ilimitada.",
      "<b>Preparar:</b> a cada dia, nas preparações, escolha até Constituição + nível habilidades do Catálogo — passivas e ativas, na mistura que quiser (tudo passiva, tudo ativa, ou misto).",
      "<b>Usar:</b> passivas preparadas ficam sempre ativas; ativas preparadas você dispara gastando 1 Foco.",
    ],
  },
  minorBlessings: [
    {
      level: 1,
      name: "Grande Sábio",
      text: "1 ação: analise uma criatura e cadastre habilidades dela no Catálogo sem precisar matá-la. Gastar 1 Foco dispensa o teste de absorção.",
    },
    {
      level: 1,
      name: "Devorar",
      text: "1 ação, ataque voraz: se reduzir o alvo a 0 HP, absorve na hora. Gastando 3 Foco, Devora uma criatura viva — arranca um pedaço (não a mata) e tenta absorver uma habilidade.",
    },
    {
      level: 3,
      name: "Metamorfose",
      text: "1 ação + 1 Foco: troque uma habilidade preparada por outra do Catálogo, na hora.",
    },
    {
      level: 4,
      name: "Mímica",
      text: "Copie a forma e a aparência de uma criatura do seu Catálogo — disfarce perfeito.",
    },
    {
      level: 6,
      name: "Evoluir",
      text: "Metamorfose troca 1 habilidade sem Foco; ou gaste 1 Foco pra trocar todas as preparadas de uma vez.",
    },
    {
      level: 8,
      name: "Digestão Acelerada",
      text: "Contra criaturas de nível igual ou menor que o seu, absorver ou cadastrar não exige teste nem ação.",
    },
    {
      level: 12,
      name: "Predador Supremo",
      text: "Passivas ficam ilimitadas (fora do pool); o pool (Constituição + nível) passa a valer só pras ativas.",
    },
  ],
  panels: [
    {
      title: "RECARGA DE FOCO",
      subtitle: "Bestiário",
      paragraphs: [
        "Refocus padrão (10 min): recupera 1 Ponto de Foco.",
        "Em jogo: +1 Foco quando você cadastra uma habilidade nova no Catálogo via Grande Sábio (1x por habilidade) — o monstro aprende e cresce.",
      ],
    },
  ],
  actions: [
    {
      id: "coletar",
      name: "Coletar",
      level: 1,
      cost: "none",
      focus: 0,
      text: "Ao reduzir uma criatura a 0 HP, um teste (DC pelo nível dela) adiciona uma habilidade dela ao seu Catálogo.",
      origin: "major",
    },
    {
      id: "disparar-ativa",
      name: "Disparar habilidade preparada (ativa)",
      level: 1,
      cost: "none",
      focus: 1,
      text: "Ativas preparadas você dispara gastando 1 Foco. Passivas preparadas ficam sempre ativas.",
      origin: "major",
    },
    {
      id: "grande-sabio",
      name: "Grande Sábio",
      level: 1,
      cost: "1",
      focus: 0,
      text: "Analise uma criatura e cadastre habilidades dela no Catálogo sem precisar matá-la. Gastar 1 Foco dispensa o teste de absorção.",
      origin: "minor",
    },
    {
      id: "devorar",
      name: "Devorar",
      level: 1,
      cost: "1",
      focus: 0,
      text: "Ataque voraz: se reduzir o alvo a 0 HP, absorve na hora. Gastando 3 Foco, Devora uma criatura viva — arranca um pedaço (não a mata) e tenta absorver uma habilidade.",
      origin: "minor",
    },
    {
      id: "metamorfose",
      name: "Metamorfose",
      level: 3,
      cost: "1",
      focus: 1,
      text: "Troque uma habilidade preparada por outra do Catálogo, na hora. No nível 6 a troca de 1 habilidade sai sem Foco.",
      origin: "minor",
    },
    {
      id: "evoluir",
      name: "Evoluir — trocar todas",
      level: 6,
      cost: "1",
      focus: 1,
      text: "Troque todas as habilidades preparadas de uma vez.",
      origin: "minor",
    },
  ],
  tracker: {
    kind: "catalog",
    id: "catalog",
    title: "Catálogo do Predador",
    placeholder: "habilidade absorvida…",
    passivesUnlimitedFromLevel: 12,
    note: "Coleção permanente do que você absorveu. Prepare até Constituição + nível por dia. Passivas preparadas ficam ativas; ativas custam 1 Foco.",
  },
};

const FODAO: IsekaiArchetype = {
  id: "fodao",
  name: "O FODÃO",
  axis: "EIXO DE COMBATE BRUTO",
  tagline: "O poder não vem de técnica. Vem de ser absurdo.",
  color: "#bb3a33",
  revokes: "A curva de poder por nível e o multiple attack penalty (MAP).",
  inspirations: "Saitama · Kirito · Ainz",
  majorBlessing: {
    title: "Físico Impossível",
    paragraphs: [
      "Passiva, sempre ativa — sem custo.",
      "<b>Quatro ações por turno</b> (em vez de três); mantém 1 reaction. Haste e similares ainda valem, até o teto de 5 ações por turno.",
      "<b>Seus Strikes ignoram o MAP:</b> todos os ataques saem no bônus de ataque cheio. Outras penalidades (off-guard, frightened) ainda contam.",
      "Não aumenta o dano por golpe — multiplica o volume. Cada Strike causa o dano normal do PF2e (arma + runes + weapon specialization).",
    ],
  },
  minorBlessings: [
    {
      level: 1,
      name: "Couraça de Protagonista",
      text: "Resistência a dano físico (B/P/S) igual à metade do seu nível (mínimo 1).",
    },
    {
      level: 1,
      name: "Vitalidade Sobre-Humana",
      text: "HP máximo aumenta em seu nível; o DC do recovery check (dying) cai em 1.",
    },
    {
      level: 3,
      name: "Esmagar a Escala",
      text: "Strikes que acertam criaturas de nível igual ou menor que o seu menos 4 causam dano máximo, sem rolar.",
    },
    {
      level: 4,
      name: "Onda de Choque",
      text: "Ao acertar um melee Strike, cada inimigo adjacente ao alvo sofre dano fixo igual ao seu nível (como o respingo de uma poção).",
    },
    {
      level: 6,
      name: "Passada Imparável",
      text: "Speed +10 ft e ignora difficult terrain. 1x por combate, no seu primeiro turno, faça Stride como ação livre.",
    },
    {
      level: 8,
      name: "Pele Que Ri da Dor",
      text: "A Couraça passa a reduzir todo tipo de dano, não só o físico.",
    },
    {
      level: 12,
      name: "Plot Armor",
      text: "1x por encontro, quando você cairia a 0 HP, fica com 1 HP em vez disso.",
    },
  ],
  panels: [
    {
      title: "SOCO SÉRIO",
      subtitle: "AÇÃO ATIVA · 2 ações · custa 2 Foco",
      paragraphs: [
        "Faça um melee Strike. Em acerto, ele conta como acerto crítico (dano dobrado) e ignora a resistência do alvo; o alvo é empurrado 10 ft e fica prone. Se o ataque já fosse um crítico, adiciona dano extra igual à metade do seu nível em d6.",
      ],
    },
    {
      title: "RECARGA DE FOCO",
      paragraphs: [
        "Refocus padrão (10 min): recupera 1 Ponto de Foco, como no PF2e.",
        "Em combate (máx. 1x por rodada): recupere 1 Foco ao reduzir a 0 HP uma criatura de nível igual ou maior que o seu. Contra inimigos mais fracos, nada — o Fodão só se acende contra desafio real.",
      ],
    },
  ],
  actions: [
    {
      id: "soco-serio",
      name: "Soco Sério",
      level: 1,
      cost: "2",
      focus: 2,
      text: "Faça um melee Strike. Em acerto, conta como acerto crítico e ignora a resistência do alvo; o alvo é empurrado 10 ft e fica prone. Se já fosse crítico, adiciona metade do seu nível em d6 de dano extra.",
      origin: "panel",
    },
    {
      id: "passada",
      name: "Passada Imparável (Stride livre)",
      level: 6,
      cost: "free",
      focus: 0,
      frequency: "1x por combate",
      text: "No seu primeiro turno, faça Stride como ação livre.",
      origin: "minor",
    },
    {
      id: "plot",
      name: "Plot Armor",
      level: 12,
      cost: "none",
      focus: 0,
      frequency: "1x por encontro",
      text: "Quando você cairia a 0 HP, fica com 1 HP em vez disso.",
      origin: "minor",
    },
  ],
  tracker: {
    kind: "uses",
    id: "limitedUses",
    title: "Usos Limitados",
    uses: [
      { id: "passada", name: "Passada Imparável (Stride livre)", scope: "1x/combate", level: 6 },
      { id: "plot", name: "Plot Armor (fica com 1 HP)", scope: "1x/encontro", level: 12 },
    ],
    note: "Marque ao usar; desmarque ao começar o novo combate/encontro.",
  },
};

const QUERIDINHO: IsekaiArchetype = {
  id: "queridinho",
  name: "O QUERIDINHO DE DEUS",
  axis: "EIXO DA BÊNÇÃO DIVINA",
  tagline: "Eu não escolhi esse dom. Fui escolhido.",
  color: "#e3c84e",
  revokes: "A especialização de build — os gates de classe e raça.",
  inspirations: "Touya (Isekai Smartphone) · Ryoma (By the Grace of the Gods) · Maple (Bofuri)",
  majorBlessing: {
    title: "Filho Favorito",
    paragraphs: [
      "<b>Build Abençoada:</b> você conta como membro de toda classe e toda ancestry — de PF2e e de Starfinder 2e — para pré-requisitos e efeitos. Nos seus slots de feat, pegue feats de classe e de ancestry de qualquer fonte, respeitando só nível, atributo e cadeias de pré-requisito.",
      "<b>Gadget Divino:</b> você porta um item-dádiva versátil — o “celular do outro mundo”: comunicação à distância, mapa, busca, luz e tradução. Novas funções desbloqueiam conforme você sobe de nível.",
      "<b>Dom Emprestado:</b> gaste 1 Foco pra usar, por um momento, uma habilidade de classe que você não possui — o deus te empresta o poder.",
    ],
  },
  minorBlessings: [
    {
      level: 1,
      name: "Feat de Classe",
      text: "Pegue um feat de classe extra (de qualquer classe, via Build Abençoada).",
    },
    {
      level: 1,
      name: "Feat de Ancestralidade",
      text: "Pegue um feat de ancestralidade extra (de qualquer ancestry).",
    },
    { level: 3, name: "Feat de Classe", text: "Pegue um feat de classe extra." },
    { level: 5, name: "Feat de Ancestralidade", text: "Pegue um feat de ancestralidade extra." },
    { level: 6, name: "Feat de Classe", text: "Pegue um feat de classe extra." },
    { level: 8, name: "Feat Livre", text: "Pegue um feat extra de qualquer tipo." },
    { level: 12, name: "Feats Livres", text: "Pegue dois feats extras de qualquer tipo." },
  ],
  minorsNote:
    "O abençoado simplesmente recebe mais: feats extras além dos da sua classe, ganhos ao atingir cada marco.",
  panels: [
    {
      title: "A BÊNÇÃO NA PRÁTICA",
      subtitle: "Você é o coringa da mesa",
      paragraphs: [
        "Monte o impossível: visão no escuro élfica, a têmpera de um anão e os punhos de um monge no mesmo herói. Garimpe os melhores feats independentes de qualquer classe — e o conteúdo de Starfinder vem junto (feats de Solarian, ancestry Android, augmentations).",
        "Lembre: muito feat depende de uma feature que você não tem — um que melhora Sneak Attack precisa de Sneak Attack. Você colhe os que valem por si só, e são muitos.",
      ],
    },
    {
      title: "FOCO & REFOCUS",
      paragraphs: [
        "Você gasta Foco apenas no Dom Emprestado e recupera pelo Refocus padrão (10 min, 1 Ponto de Foco).",
        "Diferente dos outros arquétipos, o Queridinho não tem recarga de combate — o dom dele vive na ficha, não num botão pra apertar toda rodada.",
      ],
    },
  ],
  actions: [
    {
      id: "dom-emprestado",
      name: "Dom Emprestado",
      level: 1,
      cost: "none",
      focus: 1,
      text: "Use, por um momento, uma habilidade de classe que você não possui — o deus te empresta o poder.",
      origin: "major",
    },
    {
      id: "gadget-divino",
      name: "Gadget Divino",
      level: 1,
      cost: "none",
      focus: 0,
      text: "Comunicação à distância, mapa, busca, luz e tradução. Novas funções desbloqueiam conforme você sobe de nível.",
      origin: "major",
    },
  ],
};

const SORTUDO: IsekaiArchetype = {
  id: "sortudo",
  name: "O SORTUDO",
  axis: "EIXO DE SORTE & FORTUNA",
  tagline: "O destino joga os dados. Eu escolho quais valem.",
  color: "#3a9d6a",
  revokes: "A aleatoriedade do d20.",
  inspirations: "Kazuma (KonoSuba) · Cid (Eminence in Shadow)",
  majorBlessing: {
    title: "Dados do Destino",
    paragraphs: [
      "Passiva, sempre ativa.",
      "No início de cada dia, role 3 d20 e anote os resultados — são seus <b>Dados do Destino</b> (você sabe os números).",
      "Depois de ver qualquer rolagem de d20 — sua, de um aliado ou de um inimigo que você enxergue — mas antes de saber o efeito, gaste um Dado do Destino pra substituir aquela rolagem pelo valor anotado.",
      "<b>Forçar a Sorte:</b> ao gastar um Dado, pague 1 Foco pra usar um valor à sua escolha (1–20) em vez do anotado.",
    ],
  },
  minorBlessings: [
    {
      level: 1,
      name: "Bem na Hora",
      text: "Gaste 1 Foco pra declarar uma coincidência feliz plausível fora de combate (o item certo à mão, a fechadura cede, um guarda se distrai). O GM valida o que é plausível.",
    },
    {
      level: 1,
      name: "Segunda Chance",
      text: "1x por dia, re-role uma rolagem de d20 sua e fique com o melhor resultado — sem gastar Dado do Destino.",
    },
    {
      level: 3,
      name: "Pé de Coelho",
      text: "Seu pool ganha +1 Dado do Destino (passa a rolar 4 por dia).",
    },
    {
      level: 4,
      name: "Extremos do Destino",
      text: "Passivo. Um Dado do Destino de valor 20 conta como 20 natural (dispara crítico e sobe o grau de sucesso); um de valor 1 conta como 1 natural — devastador quando cravado num inimigo.",
    },
    {
      level: 6,
      name: "Maré de Sorte",
      text: "1 ação, 1 Foco: até seu próximo turno, você e aliados a 30 ft podem re-rolar qualquer falha, ficando com o segundo resultado — seja ele qual for. A maré não escolhe lado.",
    },
    {
      level: 8,
      name: "Não Hoje",
      text: "Passivo. Quando você rolaria um crit fail (falha crítica) num save, trate como falha simples.",
    },
    {
      level: 12,
      name: "A Casa Sempre Vence",
      text: "Você começa cada dia com 2 Dados do Destino extras já fixos, além dos normais: um 20 e um 1.",
    },
  ],
  panels: [
    {
      title: "HOJE É MEU DIA DE SORTE",
      subtitle: "AÇÃO ATIVA · 1 ação · custa 2 Foco",
      paragraphs: [
        "Role 3 d20 imediatamente e some-os aos seus Dados do Destino (pela cena, mesmo acima do limite normal). É o pool reabastecido no meio da luta, quando a sorte engata.",
      ],
    },
    {
      title: "RECARGA DE FOCO",
      paragraphs: [
        "Refocus padrão (10 min): recupera 1 Ponto de Foco, como no PF2e.",
        "Em jogo (máx. 1x por rodada): recupere 1 Foco sempre que um 20 ou 1 natural for rolado na mesa — por você, um aliado ou um inimigo. A sorte e o azar de todos pendem a teu favor.",
      ],
    },
  ],
  actions: [
    {
      id: "gastar-dado",
      name: "Gastar um Dado do Destino",
      level: 1,
      cost: "none",
      focus: 0,
      text: "Depois de ver qualquer rolagem de d20 — sua, de um aliado ou de um inimigo que você enxergue — mas antes de saber o efeito, substitua aquela rolagem pelo valor anotado.",
      origin: "major",
    },
    {
      id: "forcar-a-sorte",
      name: "Forçar a Sorte",
      level: 1,
      cost: "none",
      focus: 1,
      text: "Ao gastar um Dado, use um valor à sua escolha (1–20) em vez do anotado.",
      origin: "major",
    },
    {
      id: "hoje-e-meu-dia",
      name: "Hoje É Meu Dia de Sorte",
      level: 1,
      cost: "1",
      focus: 2,
      text: "Role 3 d20 imediatamente e some-os aos seus Dados do Destino (pela cena, mesmo acima do limite normal).",
      origin: "panel",
    },
    {
      id: "bem-na-hora",
      name: "Bem na Hora",
      level: 1,
      cost: "none",
      focus: 1,
      text: "Declare uma coincidência feliz plausível fora de combate. O GM valida o que é plausível.",
      origin: "minor",
    },
    {
      id: "segunda-chance",
      name: "Segunda Chance",
      level: 1,
      cost: "none",
      focus: 0,
      frequency: "1x por dia",
      text: "Re-role uma rolagem de d20 sua e fique com o melhor resultado — sem gastar Dado do Destino.",
      origin: "minor",
    },
    {
      id: "mare-de-sorte",
      name: "Maré de Sorte",
      level: 6,
      cost: "1",
      focus: 1,
      text: "Até seu próximo turno, você e aliados a 30 ft podem re-rolar qualquer falha, ficando com o segundo resultado — seja ele qual for.",
      origin: "minor",
    },
  ],
  tracker: {
    kind: "dice-pool",
    id: "destinyDice",
    title: "Dados do Destino",
    perDay: 3,
    levelBonus: { level: 3, extra: 1 },
    fixedFrom: { level: 12, values: [20, 1] },
    note: "No início do dia, role e anote. Gaste um dado pra substituir qualquer rolagem de d20 que você veja. (Forçar a Sorte: 1 Foco pra usar um valor à escolha.)",
  },
};

const UNDERDOG: IsekaiArchetype = {
  id: "underdog",
  name: "O UNDERDOG",
  axis: "EIXO DA ADVERSIDADE",
  tagline: "Você vai ter que me matar quatro vezes.",
  color: "#a52e44",
  revokes:
    "Dano recebido = fraqueza. Em você, é o contrário: você não cai de uma vez, e a dor fortalece.",
  inspirations: "Naofumi (Shield Hero) · Hajime (Arifureta)",
  majorBlessing: {
    title: "Apanha e Levanta",
    paragraphs: [
      "<b>Três Barras:</b> você tem barreiras em 50%, 25% e 10% do seu HP. A primeira vez (por combate) que um dano te reduziria a ou abaixo de cada marca, você para exatamente nela — o excesso é perdido. Só depois de cruzar as três você morre. Nenhum golpe te derruba de uma vez: precisam te quebrar em quatro (cinco, com Não Vou Cair).",
      "<b>Desespero:</b> cada barreira quebrada te deixa mais perigoso. Você está em Desespero 1 (≤50%), 2 (≤25%), 3 (≤10%) ou 5 (a 1 HP) — suas Marcas de Desespero abaixo ativam nesse valor (o N). Sim, pula o 4: no fundo do poço, você dá um salto.",
    ],
  },
  minorBlessings: [
    { level: 1, name: "Fúria", text: "+N de status no dano dos seus ataques." },
    { level: 1, name: "Couraça de Sangue", text: "+N de status na CA." },
    {
      level: 3,
      name: "Vontade de Ferro",
      text: "+N de status nos saves e no acerto dos seus ataques.",
    },
    { level: 4, name: "Golpe Brutal", text: "Seus Strikes ganham +N dados de dano por ataque." },
    {
      level: 6,
      name: "Instinto Selvagem",
      text: "+N de status em Perception e iniciativa, e +5 ft de Speed por N.",
    },
    {
      level: 8,
      name: "Não Vou Cair",
      text: "1x por encontro, quando cairia a 0 HP, você fica com 1 HP — e entra em Desespero 5.",
    },
    {
      level: 12,
      name: "Renascer das Cinzas",
      text: "1x por dia, ao morrer, reergue com 50% do HP e todas as barras restauradas.",
    },
  ],
  minorsNote:
    "Marcas de Desespero — todas escalam com o seu Desespero atual (o N). As de nível 1 vêm de início.",
  panels: [
    {
      title: "AGORA É MINHA VEZ",
      subtitle: "REAÇÃO · custa 1 Foco",
      paragraphs: [
        "Quando um inimigo te causa dano, revide na hora com um Strike — resolvido como se você estivesse em Desespero 3 (N=3), não importa quão ferido você esteja.",
      ],
    },
    {
      title: "RECARGA DE FOCO",
      paragraphs: [
        "Refocus padrão (10 min): recupera 1 Ponto de Foco.",
        "Em jogo: +1 Foco cada vez que você cruza uma barreira (50%, 25%, 10%, 1 HP) — apanhar carrega a bateria.",
      ],
    },
  ],
  actions: [
    {
      id: "agora-e-minha-vez",
      name: "Agora É Minha Vez",
      level: 1,
      cost: "reaction",
      focus: 1,
      text: "Quando um inimigo te causa dano, revide na hora com um Strike — resolvido como se você estivesse em Desespero 3 (N=3), não importa quão ferido você esteja.",
      origin: "panel",
    },
    {
      id: "nao-vou-cair",
      name: "Não Vou Cair",
      level: 8,
      cost: "none",
      focus: 0,
      frequency: "1x por encontro",
      text: "Quando cairia a 0 HP, você fica com 1 HP — e entra em Desespero 5.",
      origin: "minor",
    },
    {
      id: "renascer-das-cinzas",
      name: "Renascer das Cinzas",
      level: 12,
      cost: "none",
      focus: 0,
      frequency: "1x por dia",
      text: "Ao morrer, reergue com 50% do HP e todas as barras restauradas.",
      origin: "minor",
    },
  ],
  tracker: {
    kind: "stage",
    id: "despair",
    title: "Desespero",
    stages: [
      { value: 0, label: "Pleno" },
      { value: 1, label: "≤50%" },
      { value: 2, label: "≤25%" },
      { value: 3, label: "≤10%" },
      { value: 5, label: "1 HP" },
    ],
    note: "O N atual escala suas Marcas de Desespero (+N). Cada barreira cruzada (50/25/10/1 HP) é 1x por combate e recarrega 1 Foco.",
  },
};

/**
 * The eight archetypes, in catalogue order (alphabetical by id — the order
 * the selector and the merged blessing list render in, so the sheet is
 * deterministic no matter which one was picked first).
 */
export const ISEKAI_ARCHETYPES: readonly IsekaiArchetype[] = [
  CARISMATICO,
  CRAFTER,
  ESPECIALISTA,
  EVOLUTIVO,
  FODAO,
  QUERIDINHO,
  SORTUDO,
  UNDERDOG,
];
