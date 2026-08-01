# Rodada r14 — plano (2026-07-06, madrugada)

Feedback do usuário (print da ficha; ele vai montar a ficha do Tobias "exatamente como será"). Execução AUTÔNOMA: sem mensagens no chat até o fim; relatório final em .md no chat; ao concluir TUDO, **desligar o PC (autorizado nesta sessão)**. Entregas pequenas: cada batch verde = commit+push imediato (repo privado github.com/xansde/fusion; push exige `gh auth switch xansde` e restaurar `xansde-seazone`).

## Feedback bruto (itens)

1. Tradução inconsistente: barra lateral (Plano), título do popup de detalhes e aba de Ações mostram EN para "Magus's Analysis" e "Bon Mot" (únicos não traduzidos — todos embutidos); painel direito da aba Ações mostrou descrição EN para Magus's Analysis. REGRA NOVA do usuário: pt-BR SEMPRE como nome principal + EN SEMPRE de subtítulo, mesmo quando idênticos.
2. Tela de escolha de magias: ELOGIADA ("maravilhosa" — separação de elevação, críticos etc.). Magias em pt-BR 🎉. Pesquisa no compêndio ok.
3. Na aba Spells não dá para clicar no nome da magia para ler o que faz — "isso faz falta".
4. Tela "Feats" é inútil (Plano cumpre o papel) — REMOÇÃO AUTORIZADA pelo usuário (escopo da r14: tirar a aba Feats da ficha). Falta tela de Pets → deixar para futuro, MAS rodar agente estudando regras de pets/companheiros/familiares e preparar specs.
5. Selecionar "Starlit Span" não liberou automaticamente "Shooting Star" na aba de magias de foco. (E "Shooting Star" citada na descrição não é clicável — follow-up futuro poderoso: @UUID clicável nas descrições.)
6. Slot de ability boosts: em vez de "cha, cha, dex, cha, str, wis, cha, dex", grid 3×2 com líquido por atributo (+1, +2, +0, +0, +1, +4 na ordem FOR/DES/CON/INT/SAB/CAR).
7. Alchemist Dedication deveria conceder mais feats aparecendo como chips de cadeado. Estudo item a item das seleções da ficha REAL do Tobias: regras esperadas × ficha × tradução em todo lugar × ações disponíveis × rolagens clicáveis — "ficha com fácil acesso a qualquer informação", caso 100%.
8. Priorizar por velocidade estimada, agrupando itens que se resolvem juntos; executar na ordem ideal.

## Hipóteses de causa raiz (confirmar no código)

- Magus's Analysis/Bon Mot em EN: itens EMBUTIDOS. (a) Slots do Plano nunca traduzem nome (planVM sem tradutor de nomes); (b) título do PlanDetailsDialog usa prop `name` cru; (c) na aba Ações a herança de namePt via dedupe falhou — provável embedded feat SEM system.slug → dedupe por slug não casa → sem fallbackUuid → painel direito mostra descrição embutida EN. Fix: join por NOME normalizado como fallback (mesmo padrão do buildSpellNameTranslator das magias, que não têm slug nos packs).
- Shooting Star: GrantItem fixo (UUID) dos rule elements NUNCA executa no builder (gap conhecido desde r12; mechanics.json do r13 exclui grants fixos por design — B2 lê REs direto dos docs de pack: campo systemRules/unconvertedRules preservado).

## Batches (territórios disjuntos por fase)

ORDEM REVISADA pelo usuário: a AUDITORIA (B3) vem PRIMEIRO — pode revelar itens importantes corrigíveis junto dos demais batches.

### Fase 0 — B3 AUDITORIA item a item da ficha do Tobias (PRIMEIRA COISA)

- (opus, com playwright + cópia fresca do mundo db+wal+shm). Para CADA seleção da ficha real: regras esperadas (doc do pack: descrição+REs) × o que a ficha mostra (chips/grants/ações/magias) × tradução em TODAS as superfícies × rolagens clicáveis. Output: TABELA DE GAPS priorizada com apontamento de a qual batch (B1/B2/B4/novo) cada gap pertence — os prompts dos batches seguintes incorporam esses achados. Read-only: não edita código.

### Fase 1 (paralelo, prompts enriquecidos pelos achados da auditoria)

- **B1 — pt-BR em todo lugar + grid de boosts + REMOÇÃO DA ABA FEATS** (opus). Território: CharacterSheet.svelte (lista de abas + painel feats), planVM.ts, components/sheets/pf2e/plan/\*\* (PlanSlot/PlanAutoChip/LevelCard/PlanColumn/PlanDetailsDialog/ABCCard), actionsVM.ts + ActionsTab.svelte, i18n (cirúrgico). Entregas: tradutor de nomes de conteúdo no Plano (índices de feats-core/class-features-core/ancestries/heritages/backgrounds/spells via compendium API, cache on-demand, padrão buildSpellNameTranslator); slots/chips/título do popup em pt-BR + EN subtítulo SEMPRE (mesmo idênticos, para todo conteúdo de pack); aba Ações: dedupe fallback por nome normalizado quando slug ausente (conserta namePt + fallbackUuid + descrição do painel p/ Magus's Analysis/Bon Mot); grid 3×2 de boosts no slot preenchido (líquido por atributo). Testes.
- **B4 — magia clicável na aba Spells** (opus). Território: SpellsTab.svelte + characterSheetVM se preciso (getters). Clique no NOME (truques, slots preparados, grimório, foco) abre popup de detalhes (DocumentDetailsPanel, doc do pack via join por nome/uuid com cache; embutida sem par → descrição embutida; pt-BR preferido). Não quebrar Lançar/Trocar/Preparar (clique no nome ≠ botões de ação; hoje clicar no nome dispara rolagem de ataque?? — verificar e mover rolagem para botão explícito se for o caso).
- **B5 — pesquisa Pets/Companions/Familiars** (sonnet, pesquisa). Estudar vendor (packs familiar-abilities, animal companions em classfeatures?, docs/research existentes) + regras remaster: familiars (abilities diárias), animal companions (progressão, stats, comandos), pets genéricos. Produto: `specs/29-pets-companions-familiars.md` (formato das outras specs, REQ-PET-NNN, [MVP]/[V2], modelo de dados, UI da ficha, integração builder) + resumo em docs/research se fizer sentido. SEM implementação.

### Fase 2 (após B1 — mesmo território planVM)

- **B2 — grants fixos automáticos** (opus). Território: planVM.ts + plan/\*\*, systems/pf2e (schemas/derivations se necessário), server nada (itens embutidos via ops normais). Entregas: ao aplicar feat/feature no builder, materializar GrantItem de UUID fixo dos REs do doc (spell→entry certa [focus → entry isFocusPool], feat/feature→chip cadeado aninhado ao granter, estilo GRANTED_FEAT_CHOICES r11), remoção em cascata; idempotente (marcar grantedBy no item embutido); HEAL: ao abrir o Plano (dono/GM), detectar granters já aplicados com grants ausentes e materializar (op única, log no console). Casos de aceite: Starlit Span→Shooting Star na aba Foco; Alchemist Dedication→Alchemical Crafting (+ o que os REs declararem) como chips de cadeado. Testes planVM.
- Depois de B2: rebuild client + restart dev 33100 com cópia FRESCA do mundo (db+wal+shm juntos; servidor do usuário pode estar aberto — copiar mesmo assim, é cópia descartável).

### Fase 3 — residuais da auditoria

- Gaps da auditoria (Fase 0) que não couberam em B1/B2/B4: fixes por território conforme o achado + re-verificação dos itens corrigidos.

### Fase 4 — fechamento

1. Suítes completas + svelte-check. 2. Verificação viva final (playwright, jogador dono) dos itens 1-7. 3. Exe + smoke (registrar sha). 4. BUILD-LOG seção r14 + vault (context/todo/lessons) + memória. 5. Relatório final .md NO CHAT (o que mudou, como testar, gaps restantes, follow-ups). 6. **Desligar o PC**: PowerShell tool com `shutdown /s /t 60` (NUNCA via Git Bash — mangla /s). Antes de desligar: garantir tudo commitado+pushado.

## Follow-ups registrados (fora da r14)

- @UUID clicável dentro de descrições (abrir detalhes do doc citado).
- Tela de Pets/Companions (implementação; specs saem nesta rodada).
- 7 warnings heurísticos de glossário; nomes cunhados em EN por decisão (magus, ratfolk→ratkin).

## Regras operacionais desta rodada

- SEM mensagens de progresso no chat (usuário dormindo; economizar créditos). Notificações de task são turnos de trabalho, não de relatório.
- Anti-narrador em TODO prompt de agente: "EXECUTE INLINE, PROIBIDO delegar/aguardar agentes".
- Nunca matar processo por nome; 33000 é do usuário (ele pode abrir/fechar o exe durante a noite — se 33000 estiver vivo, não tocar).
- Commits pequenos por batch verde + push imediato (conta xansde).
- Agente morto em silêncio (0 bytes/1 tool call): verificar território via git status + terminar inline ou relançar 1 worker autorizado.
