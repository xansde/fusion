- **A classe está pronta; o combate é que não está.** O Guerreiro é a primeira das três classes
  inventariadas que já está publicada no pin, com pt-BR completo (112/112 talentos, 16/16
  habilidades) e construção de ficha verificada (a varredura de classes passa 6/6 nele). Nenhuma
  fase aqui é "colocar a classe no ar" — toda a fila é combate.
- **Nenhum dos 129 documentos funciona hoje.** Dos 50 mecanismos que eles exigem, **um** funciona
  ([[mec-gue-class-published]]); os outros 49 estão ausentes ou parciais.
- **[[mec-weapon-strike]] bloqueia 54 documentos** — mais do que qualquer outro. É 🟡 e não ❌ por
  um detalhe importante: a derivação do golpe existe, a ficha tem botões reais e o servidor já sabe
  graduar ataque contra CA. O que falta é o alvo: **nada no cliente preenche o campo de alvo da
  rolagem**, então o ataque nunca encontra a CA de ninguém e o crítico é o jogador que escolhe,
  clicando "Crítico" em vez de "Dano".
- **[[mec-effect-source-items]] (29 documentos) é o achado que vale além do Guerreiro.** O motor de
  efeitos RODA em produção (`packages/server/src/net/derive-runner.ts:289`), mas só recebe
  **condições** — talento, habilidade e item nunca viram fonte de efeito. Resultado: 83 das 86
  regras escritas nos documentos do Guerreiro são inertes (45 `flat-modifier`, 17 `roll-option`,
  10 `roll-note`, 6 `set-property`, 5 `proficiency`); só as 3 `grant-item` funcionam, por um
  caminho próprio. É uma peça só, e ela destrava regra passiva de **todas** as classes.
- **A F1 destrava só 2 documentos, e isso é o retrato da classe**: o Guerreiro quase não tem
  habilidade que dependa apenas de bater. O que ele tem é talento — e talento depende do motor de
  efeitos (F2), da posição no mapa (F3), da reação (F4) e do escudo/manobra/mão (F5). As duas fases
  do meio, **F5 e F6, sozinhas fecham 80 dos 129**.
- **Reação é o buraco mais próprio desta classe**: 23 documentos precisam que o servidor perceba um
  gatilho e ofereça a reação — e o conceito não existe no modelo de dados. Duas das 16 habilidades
  (Golpe Reativo e Bloqueio de Escudo, ambas de nível 1) já caem aí.
- **Saber o que cada mão segura** ([[mec-new-hand-state]], 21 documentos) foi a exigência mais
  inesperada do levantamento: o campo existe no schema como valor padrão e **nunca é lido**.
- Pendentes por documento: 1 → 9 · 2 → 23 · 3 → 42 · 4 → 34 · 5 → 17 · 6 → 3 · 8 → 1.
- **No braço dá**: 26 documentos são resolvíveis na mesa sem esforço e 94 com contabilidade manual;
  só 9 são inviáveis sem o sistema.
- **Dado publicado**: ações de manobra 14/14 e condições 16/16 — completas. Mas as armas são o ponto
  magro: **30 armas**, 11 dos 16 grupos, e **zero** com trait `fatal` ou `free-hand`. Efeitos: não
  há pack (0 de 4 referenciados). Arquétipo: **0 de 6** talentos publicados, embora já convertidos
  em `tools/importer-pf2e/out/feats/` no core.
