// Shared character data for the Ficha PF2e UI kit — Tobias, Ratfolk Magus 3.
const DS = window.FusionVTTDesignSystem_1daa5f;

const TOBIAS = {
  name: "Tobias",
  identity: "Ratfolk (Snow Rat) • Fireworks Performer • Magus 3",
  hp: { current: 33, max: 33 },
  ac: 19,
  saves: [
    { label: "Fort", value: "+8" },
    { label: "Reflexos", value: "+8" },
    { label: "Vontade", value: "+7" },
  ],
  perception: "+5",
  attrs: [
    { label: "FOR", value: "+0" },
    { label: "DES", value: "+3" },
    { label: "CON", value: "+1" },
    { label: "INT", value: "+3" },
    { label: "SAB", value: "+0" },
    { label: "CAR", value: "+2" },
  ],
  heroism: { filled: 1, cap: 3 },
  focus: { filled: 1, total: 1, cap: 3 },
  // All 17 PF2e skills, always visible.
  skills: [
    { rank: "U", name: "Acrobacia", mod: "+3" },
    { rank: "T", name: "Arcanismo", mod: "+8" },
    { rank: "U", name: "Atletismo", mod: "+0" },
    { rank: "E", name: "Ofícios", mod: "+10" },
    { rank: "U", name: "Enganação", mod: "+2" },
    { rank: "T", name: "Diplomacia", mod: "+7" },
    { rank: "U", name: "Intimidação", mod: "+2" },
    { rank: "T", name: "Medicina", mod: "+5" },
    { rank: "U", name: "Natureza", mod: "+0" },
    { rank: "T", name: "Ocultismo", mod: "+8" },
    { rank: "T", name: "Atuação", mod: "+7" },
    { rank: "U", name: "Religião", mod: "+0" },
    { rank: "T", name: "Sociedade", mod: "+8" },
    { rank: "T", name: "Furtividade", mod: "+8" },
    { rank: "U", name: "Sobrevivência", mod: "+0" },
    { rank: "T", name: "Ladinagem", mod: "+8" },
    { rank: "T", name: "Conhecimento (Fogos de Artifício)", mod: "+8" },
  ],
  plan: {
    abc: [
      { typeLabel: "Ancestralidade", name: "Ratfolk" },
      { typeLabel: "Herança", name: "Snow Rat" },
      { typeLabel: "Antecedente", name: "Fireworks Performer" },
      { typeLabel: "Classe", name: "Magus", subLine: "Estudo Híbrido: Starlit Span" },
    ],
    levels: [
      {
        level: 1,
        slots: [
          { name: "Dádivas de Atributo", type: "4 aumentos de atributo" },
          { name: "Tinkering Fingers", type: "Talento de Ancestralidade" },
          { name: "Starlit Span", type: "Estudo Híbrido" },
          { name: "Arcanismo + 5 outras", type: "Treinamento de Perícias" },
        ],
        auto: ["Conjuração Arcana", "Golpe Feiticeiro", "Magias de Confluência"],
      },
      {
        level: 2,
        slots: [
          { name: "Magus's Analysis", type: "Talento de Classe" },
          { name: "Impressive Performance", type: "Talento de Perícia" },
          { name: "Alchemist Dedication", type: "Arquétipo Livre", optional: true },
        ],
      },
      {
        level: 3,
        slots: [
          { name: "Read Lips", type: "Talento Geral" },
          { name: "Ofícios → Especialista", type: "Aumento de Perícia" },
        ],
        auto: ["Reação de Classe"],
        empty: "+ Escolher talento de classe",
      },
    ],
  },
  spells: {
    dc: 18,
    attack: "+8",
    tradition: "Arcana",
    keyAttr: "INT",
    prof: "T",
    cantrips: ["Detectar Magia", "Arco Elétrico", "Escudo", "Mordida do Gelo", "Projétil Telecinético"],
    ranks: [
      { rank: 1, prepared: [{ name: "Rajada de Força", available: true }], openSlots: 1 },
      { rank: 2, prepared: [{ name: "Névoa Obscurecente", available: true }], openSlots: 0 },
    ],
    grimoire: ["Graxa", "Golpe Certeiro", "Tentáculos Sombrios"],
    focusSpell: { name: "Estrela Cadente", note: "Patamar 2 • consome 1 ponto de foco" },
  },
};

// Sample compendium results for the picker modal.
const COMPENDIUM = [
  { rank: 1, actionCost: "2A", name: "Rajada de Força", traits: ["Evocation", "Force"], source: "Player Core" },
  { rank: 1, actionCost: "1A", name: "Graxa", traits: ["Conjuration"], source: "Player Core" },
  { rank: 1, actionCost: "2A", name: "Golpe Certeiro", traits: ["Evocation"], source: "Player Core" },
  { rank: 1, actionCost: "2A", name: "Tentáculos Sombrios", traits: ["Conjuration"], source: "Player Core" },
  { rank: 1, actionCost: "1A", name: "Escudo do Feiticeiro", traits: ["Evocation", "Force"], source: "Player Core" },
  { rank: 2, actionCost: "2A", name: "Névoa Obscurecente", traits: ["Conjuration"], source: "Player Core" },
  { rank: 2, actionCost: "2A", name: "Golpe Flamejante", traits: ["Evocation"], source: "Player Core" },
  { rank: 0, actionCost: "1A", name: "Projétil Telecinético", traits: ["Evocation", "Mental"], source: "Player Core" },
  { rank: 0, actionCost: "2A", name: "Arco Elétrico", traits: ["Evocation"], source: "Player Core" },
  { rank: 0, actionCost: "1A", name: "Detectar Magia", traits: ["Conjuration"], source: "Player Core" },
];

window.TOBIAS = TOBIAS;
window.COMPENDIUM = COMPENDIUM;
