# Prompt pronto para o Claude Design (ficha PF2e r10)

Cole no campo "What will you design today?" do Claude Design. Se tiver o design system
"Fusion" configurado, selecione-o em **Design system** antes de enviar (aí ele já usa os
tokens e componentes certos). Anexe os 5 HTMLs de `.fusion-build/r10-design/` pelo botão **+**
para o Claude iterar sobre o layout existente em vez de começar do zero.

---

Redesenhe a ficha de personagem do Fusion VTT (um virtual tabletop dark, tema violeta,
inspirado em Foundry mas com layout melhor, referência Pathbuilder 2e). Sistema: Pathfinder 2e
remaster. Idioma da UI: pt-BR.

Use EXATAMENTE estes tokens (tema real do app):
bg #0e0e12 · surface #18181f · surface-alt #1f1f2a · border #2e2e3d · text #e8e8f0 ·
muted #8888a0 · subtle #55556a · accent #7c5cfc (violeta, só em elementos interativos/ativos) ·
success #3ddc84 · warning #ffc857 · danger #ff5c5c · radius 4/8/12 · fonte system-ui, 14px.
Badges de proficiência TEML: U=cinza subtle, T=accent, E=success, M=warning, L=danger.

Personagem de referência (use estes dados reais): Tobias, Ratfolk (Snow Rat) Magus 3,
Fireworks Performer, Small, deslocamento 25 ft. CD de Magia 18 / Ataque de Magia +8 (INT).
HP 33/33, CA 19 (armadura de couro). Fort +8, Ref +8, Will +7, Percepção +5, Iniciativa +5.
Atributos: FOR +0, DES +3, CON +1, INT +3, SAB +0, CAR +2. Heroísmo 1/3. Foco 1 de máx 3.

Telas a projetar:

1. Ficha completa: coluna "Plano" colapsável à esquerda (montagem nível a nível estilo
   Pathbuilder) + corpo central com stats sempre visíveis + as 17 perícias (todas visíveis,
   inclusive as destreinadas, cada linha rolável) + abas Principal/Perícias/Ações/Magias/
   Inventário/Talentos/Bio + toggle Jogar/Editar.
2. Coluna "Plano": cards Ancestralidade/Herança/Antecedente/Classe + um card por nível (1..3)
   com os slots de escolha (Talento de Classe, de Perícia, Geral, de Ancestralidade,
   Treinamento/Aumento de Perícia, Estudo Híbrido, Arquétipo Livre), incluindo estado de slot
   vazio (tracejado) e botão "Subir de nível".
3. Aba Magias com sub-abas por origem: Magus · Alquimista (Arquétipo) · Foco · Rituais.
   Truques, slots por patamar com Preparar/Trocar/Gastar, Grimório com "+ Adicionar magia",
   pips de Foco (1/3).
4. Modal de compêndio para adicionar/trocar magia (busca, filtros de patamar, tradição Arcana).

Estética sóbria de ferramenta: hierarquia tipográfica clara, grid de 8px, hover/ativo visíveis,
nada de gradiente berrante. O acento violeta aparece só no que é interativo/ativo.
