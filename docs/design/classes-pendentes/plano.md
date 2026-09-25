# Plano — todas as classes até o nível 3 no mundo misto

Objetivo: no mundo misto (`pf2e-sf2e`), criar e subir até o nível 3 um personagem de **qualquer
uma das 40 classes** (29 PF2e, 6 SF2e do Player Core e 5 de playtest). "Montada" quer dizer:
aparece no picker, as escolhas de nível 1–3 gravam no ator, e a ficha bate com uma fonte **externa**
(livro, AoN ou PDF do playtest), nunca com a tabela do próprio pack.

Levantamento de 25/09/2026 (satélite `main` em `8ed0e87`, tag v0.3.0; core `alfa/app` em `1926ec2b`).

## Estado de partida

| Grupo                   | Classes                                                           | O que falta                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fora do misto (5)       | Daredevil, Slayer (PF2e); Luminary, Mechanic, Technomancer (SF2e) | Só existem em `~/.fusion/private-packs/`; o carregador (core #215) não foi mergeado e não conhece o sistema composto. As features de nível 1–3 estão **sem nenhuma regra** (0/9, 0/5, 0/6, 0/9, 0/10), e no Mechanic e no Technomancer linhas da tabela do livro viraram feature ("Attribute Boosts", "Skill Increases", "General Feat"). |
| SF2e do Player Core (6) | Envoy, Mystic, Operative, Solarian, Soldier, Witchwarper          | Dado e curadoria prontos (batem com o AoN). Falta o motor da Onda 2 do plano SF2e (#259), a ficha T3.2–T3.4, a CA e os golpes do SF2e puro (#188), o golpe de arma do misto por cópia (#189) e o teste de paridade (#187). Mystic tem 6/9 features sem regra.                                                                             |
| PF2e (29)               | todas                                                             | Ondas 0–7a mergeadas. A Onda 7 (core #256, satélite #160) está aberta com o bloqueante #151 (molde absorve o 3º aumento do Humano, defeito do pack #152). O molde externo só tem estrutura para 8 classes; as outras 21 não têm aceite (#149). Issues por classe abertas nos níveis 1–3 (lista na Onda 3).                                |

Obs.: a busca por classe foi por dado (`featuresByLevel` ≤ 3 resolvível, talentos de classe de
nível 1 e 2 existentes). As 40 passam nesse critério; nenhuma lacuna é de dado ausente.

## Ondas

Cada onda fecha com **efeito visível na ficha** e com a revisão adversarial do diff integrado
(não por lane). Lane roda só os testes afetados; a suíte completa roda uma vez no gate da onda.
Pendência que sobrar vira issue antes da onda seguinte. Merge em `alfa/app` e no `main` do
satélite é livre depois de CI verde + revisão.

### Onda 0 — destravar o que já está pronto

- **T0.1** Corrigir o pack: Human com 2 aumentos livres e sem falha (satélite #152).
- **T0.2** Devolver o molde ao RAW (DES 12 no chassi comum) e fazer o comparador **acusar** a
  divergência em vez de absorver (core #256 / satélite #160, fecha #151). Depois disso, mergear a
  Onda 7.
- **T0.3** Levar as 5 classes de playtest de `~/.fusion/private-packs/` para os packs do satélite,
  junto com o resto (decisão P1): Daredevil e Slayer em `systems/pf2e/packs/`, Luminary, Mechanic
  e Technomancer em `systems/sf2e/packs/`. Cada documento marca em `publication` que é playtest,
  com o código e a versão do PDF. Antes do commit, conferir o aviso de licença ORC em cada PDF
  (regra clean-room: só entra o que a licença permite). Com isso o misto já enxerga as 5 pela
  união de packs que existe; o carregador privado (#215) sai do caminho crítico e segue como PR
  independente.
- **T0.4** Criar `PATCH-NOTES.md` no satélite: uma entrada por tag, com o que mudou por classe e o
  que acontece com personagem que já existe. É onde entra a troca de playtest por conteúdo oficial.

Prova: as 5 classes de playtest aparecem no picker do mundo `misto`; comparador vermelho no
Humano com o pack antigo e verde com o corrigido.

### Onda 1 — motor e combate do SF2e (depende de nada; corre junto da Onda 0)

- **T1.1** Onda 2 do plano SF2e (#259): `grant-item`, `proficiency`/`base-speed`, o subconjunto de
  ItemAlteration que aparece até o nível 3, e `strike` (arma solar do Solarian).
- **T1.2** Armadura na CA e golpes derivados no SF2e puro (#188).
- **T1.3** Golpe de arma do misto por fábrica compartilhada, e não pela cópia do SF2e; armas no
  fixture do harness 174; `ammoOk` das 11 armas tech de volta; bônus de grade no golpe (#189).
- **T1.4** Teste permanente das 6 classes, níveis 1–3 (#187), com três comparações (decisão P2):
  SF2e puro × livro, misto × livro **e** puro × misto. As duas primeiras provam que está certo; a
  terceira pega divergência que as duas deixariam passar por arredondamento de régua.

Prova: Soldier nv3 com armadura e golpe no SF2e puro e no misto, mesmos números.

### Onda 2 — ficha SF2e (depende da 1)

- **T2.1** Criação de personagem SF2e completa (T3.2 do #259).
- **T2.2** Subida de nível 1→3 com conjuração do Mystic e do Witchwarper e magias de foco (T3.3).
- **T2.3** Mecânicas das 6 classes visíveis e escolhíveis na ficha (T3.4): conexão do Mystic,
  sintonia e arma solar do Solarian, mira do Operative, estilo do Soldier, liderança do Envoy,
  paradoxo e âncora do Witchwarper. Cobre as 6/9 features do Mystic sem regra.

Prova: as 6 classes criadas no misto até o nv3, print da aba de cada mecânica.

### Onda 3 — pendências das 29 PF2e (depende da 0; corre junto das Ondas 1 e 2)

Lanes por classe, porque os arquivos são disjuntos:

- **Animist:** #124, #138, #139, #140, #167 (e #110/#114/#119 se couberem no nível 1–3).
- **Commander:** #103, #106.
- **Summoner/Witch:** #131, #134, #136, #162.
- **Exemplar/Animist:** #101 (mesma opção escolhida duas vezes).
- **Transversais:** #107 (troca de classe acumula itens), #111 (foco não enche), #154 (idiomas por
  INT em 4 de 8 classes).
- **Roteiro e2e da ficha:** #153, #155, #156.

Prova: cada lane com o personagem vivo da classe no nv3 mostrando o efeito.

### Onda 4 — as 5 classes de playtest até o nível 3 (depende da 0 e da 2)

Daredevil e Slayer entram até o nível 3 como as outras (decisão P4). Subir além disso depende de
haver jogador querendo usar.

- **T4.1** Limpar o dado do Mechanic e do Technomancer: tirar as linhas da tabela que viraram
  feature.
- **T4.2** Curar as features de nível 1–3 das 5 (hoje sem nenhuma regra): concessões, escolhas
  (eixos de classe), proficiências e magias/foco, a partir dos PDFs.
- **T4.3** Mecânicas visíveis na ficha, na régua D3 (aparece e é escolhível, sem automação de
  combate): adrenalina e proezas do Daredevil; presa e arsenal do Slayer; plataforma e holofote do
  Luminary; equipamento customizado e exocórtex do Mechanic; banco de magias e magic hacks do
  Technomancer.
- **T4.4** Issue para trocar Mechanic e Technomancer pela versão do Tech Core depois de 07/10/2026
  (já decidido no #259: entram pelo playtest agora). A troca sai com entrada no `PATCH-NOTES.md`
  (T0.4). Vale o mesmo para o Daredevil, o Slayer e o Luminary quando saírem em livro.

Prova: as 5 criadas no misto até o nv3.

### Onda 5 — aceite das 40

- **T5.1** O Alexandre faz a ficha de cada uma das 32 classes sem molde (21 PF2e, 6 SF2e e 5 de
  playtest) e traz um JSON por classe (decisão P3). Formato: o `template_for_each_class` de
  `docs/design/ficha-nivel3/molde/character-templates.json` (níveis 1, 2 e 3 com PV, CA,
  salvamentos, proficiências, perícias, talentos, foco, magias e idiomas), mais o chassi usado
  (ancestralidade, antecedente e atributos), para o comparador reproduzir a mesma ficha.
- **T5.2** Cada JSON entra no molde assim que chega, e o comparador molde × ficha gerada roda
  **classe a classe**, sem esperar as 32. Meta: divergência zero; o que divergir vira issue.
- **T5.3** Roteiro `tutorial-e2e` com prints olhados e smoke como GM e como player
  (`PROCESSO-UI.md`).

## Ordem

```
Onda 0 ──┬──> Onda 3 ───────────────┐
         │                          ├──> Onda 5
Onda 1 ──┴──> Onda 2 ──> Onda 4 ────┘
```

No máximo 2–3 worktrees ao mesmo tempo (o PC ficou lento com mais na Fatia 1). A Onda 5 anda no
ritmo dos JSONs do Alexandre: cada classe fecha quando o molde dela chega.

## Decisões (fechadas pelo Alexandre em 25/09)

- **P1. Playtest fica junto com o resto.** As 5 classes vão para os packs do satélite, como
  qualquer outro conteúdo, e não para um pack privado. Isso substitui a decisão de 15/09. Quando um
  playtest virar conteúdo oficial, a troca sai com nota de patch.
- **P2. O teste de paridade do SF2e (#187) compara as três coisas:** puro com o livro, misto com o
  livro e puro com o misto. Só assim dá certeza absoluta.
- **P3. O Alexandre preenche os moldes das 32 classes.** Ele monta a ficha de cada uma e traz um
  JSON por classe.
- **P4. Daredevil e Slayer entram até o nível 3.** Subir além disso depende de haver jogador que
  queira usar.

## Fora do escopo

Arquétipos e multiclasse além do que já existe, itens de compra, nível 4+, dano em alvo, tradução
pt-BR (satélite #168), conversão de mundo existente para `pf2e-sf2e` (M4 do mundo misto).
