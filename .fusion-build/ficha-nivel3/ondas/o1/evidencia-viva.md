# Evidência viva — Onda 1 (níveis "vivo" e "olhado")

Lane de evidência viva sobre o trabalho já implementado e commitado da Onda 1
(`docs/design/ficha-nivel3/execucao.md` seção 3, linha da Onda 1). Esta lane **não editou
código de produção** — só rodou o gate vivo e olhado contra o que já estava em
`ficha3/o1` (commits `d12d0687`, `fe96580d`, `51696f79`).

## Setup

- Worktree: `wt-o0` (buildada), branch `ficha3/o1`, satélite `fusion-systems-2e` pinado em
  `v0.2.0` (mesmo pin do fecho da Onda 0 + T1.1-T1.8).
- Data-dir isolado: `scratchpad/data-o1` (fora da worktree; nunca tocou `~/.fusion` real).
  Mundo `teste_xande` copiado de `~/.fusion/worlds/teste_xande`.
- Servidor: `node packages/server/dist/cli/index.js serve --port 33011 --data-dir
  <data-o1> --world teste_xande --no-open --log-level info`, `CI=1`. Boot saudável
  confirmado nos logs (`World opened`, `Auth routes registered`, `Server listening`,
  `Fusion server ready`).
- Browser: Playwright (`playwright-cli`, sessão `-s=o1`) — a extensão Claude in Chrome
  **não foi usada** em nenhum momento.
- Usuários criados: `GM_o1` (Mestre) / `Player_o1` (Player), senha `senha123`. Setup wizard
  do data-dir novo percorrido manualmente (Admin Key `AdminSenha33011`).

### Lacuna operacional herdada da Onda 0, resolvida aqui

O mundo `teste_xande` só tinha 2 atores `character` (`Novo Ator`, `Tobias`), ambos já
"sujos" de testes anteriores (múltiplas classes acumuladas no mesmo ator — ver Achado 1).
Como a Onda 1 precisa provar 5 famílias de classe distintas sem contaminação cruzada,
esta lane **semeou 5 atores limpos direto no `world.db`** (script descartável, não
commitado): `Exemplar_o1`, `Gunslinger_o1`, `Psychic_o1`, `Animist_o1`, `Commander_o1` —
clonados de `Novo Ator` (mesma ancestralidade Elfo/Elfo Ancestral, mesmo antecedente
Advogado), com os itens de classe removidos e `system.level.value` resetado para 1.
IDs gerados com 16 caracteres alfanuméricos (armadilha: um primeiro lote com ID de 14
chars foi rejeitado pelo servidor com `Validation failed for actors: _id: must be 16
chars` — corrigido no script antes de seguir). O servidor foi reiniciado após a
seed para carregar os novos atores (o mundo é lido do SQLite no boot, não em live-reload).

## O que foi provado — nível Vivo (ator real, servidor real) + Olhado (print)

Cada família abaixo: classe escolhida pela UI → diálogo de escolha específica
respondido → **confirmado sem erro novo no console do navegador** → **verificado direto
no `world.db` do ator** (não só na UI) → **persistência re-confirmada após reload de
página completo** (sessão manteve login; ator reaberto mostra o mesmo estado).

| Família | Ação na UI | Erro no console? | Confirmado no `world.db` | Print |
|---|---|---|---|---|
| **Exemplar** (T1.1) | Classe → Exemplar; Ícone → "Gleaming Blade" | Sim — ver **Achado 2** | `items`: `Exemplar:class`, `Gleaming Blade:classFeature`, `Flowing Spirit Strike:action` — **sem item de epíteto** | `prints/exemplar-plano-icone-triplicado-sem-epiteto.png`, `prints/exemplar-defeito-2-icones-duplicados.png` |
| **Gunslinger** (T1.2) | Classe → Gunslinger; Modo do Pistoleiro → "Way of the Pistolero" | Não | `items`: `Gunslinger:class`, `Way of the Pistolero:classFeature`, `Raconteur's Reload:action`, `Ten Paces:action` | `prints/gunslinger-way-picker-confirmado.png` |
| **Psychic** (T1.3) | Classe → Psychic; Mente Consciente → "The Distant Grasp"; Mente Subconsciente → "Emotional Acceptance" | Não | `items`: `Psychic:class`, `The Distant Grasp:classFeature`, `Emotional Acceptance:classFeature`, `Restore the Mind:action`, `occult Spells:spellcastingEntry` | `prints/psychic-duas-mentes-confirmadas.png` |
| **Animist** (T1.3) | Classe → Animist; Prática Animista → "Medium"; Sintonia de Aparição ×2 → "Crafter in the Vault" + "Custodian of Groves and Gardens" | Não | `items`: `Animist:class`, `Medium:classFeature`, `Crafter in the Vault:classFeature`, `Custodian of Groves and Gardens:classFeature`, `Relinquish Control:feat`, `divine Spells:spellcastingEntry` | `prints/animist-2-aparicoes-e-pratica-confirmadas.png` |
| **Commander** (T1.7 — fólio) | Classe → Commander; 5× "Tática Conhecida" → Wait For It..., Piranha Assault, Pincer Attack, Buckle-Cut Blitz, Insta-Ballista | Não | `items`: `Commander:class` + 5 `action` (uma por tática escolhida) | `prints/commander-folio-5-taticas-confirmadas.png` |

**Idiomas (T1.8):** os 4 personagens acima (todos ancestralidade Elfo) mostram
`Idiomas: common, elven` na aba Principal da ficha — visível nos prints do Gunslinger,
Psychic, Animist e Commander. Confirma que `stepCharLanguages` deriva e exibe os
idiomas fixos da ancestralidade corretamente. **Não** cobre o picker de idiomas
bônus por Inteligência — ver Achado 3 (é um corte de escopo já documentado no código
e já registrado como issue, não uma pendência nova).

## Achados (defeitos — não consertados, registrados)

### Achado 1 — trocar de classe num ator que já tinha classe não remove a anterior (fora do escopo desta lane, mas registrado)

Ao reaproveitar `Novo Ator` (que já tinha `Barbarian` de um teste anterior) e escolher
"Exemplar" pela UI, o `world.db` passou a ter **os dois** class items (`Barbarian` E
`Exemplar`) e as classFeatures antigas (`Rage`, `Quick-Tempered`, `Furious Footfalls`)
continuaram presentes junto das novas. O label "Classe" no topo do Plano também não
atualizou até a próxima leitura fresca. Isso não bloqueou a Onda 1 (contornado
semeando atores limpos), mas é um buraco de produto real: não existe fluxo de "trocar
de classe" que limpe a classe anterior. Repro: pegar qualquer ator com classe já
definida, abrir o diálogo de Classe, escolher outra, confirmar — o `items` acumula.
**Pendência → issue** (ver abaixo).

### Achado 2 — Exemplar nível 1: ikon vira 3 slots duplicados, `rootEpithet` não existe

Ver tabela acima. Ao confirmar a classe Exemplar, o Plano nível 1 mostra 3 botões
"Ícone" idênticos (mesmo diálogo "Escolher Ícone", mesma lista de 21 ikons) e nenhum
slot de Epíteto. Ao escolher um ikon, o console registra
`[Plan grants] applied Gleaming Blade: 1 grant(s) did not resolve —
unresolved-placeholder: [Gleaming Blade → {item|flags.system.rulesSelections.grantedIkon}]`.
Pela regra RAW do Exemplar (remaster), nível 1 dá exatamente 1 ikon + 1 epíteto raiz.
**Issue aberta:** https://github.com/xansde/fusion-systems-2e/issues/104

### Achado 3 — idiomas bônus por Int: corte de escopo já documentado, não é achado novo

`external/fusion-systems-2e/systems/pf2e/src/derivations/character.ts` (linhas 225-239)
documenta explicitamente que só os idiomas FIXOS da ancestralidade são derivados; o
picker de idiomas bônus (ancestralidade `additionalLanguages.count` + modificador de
Inteligência positivo) foi cortado do escopo da Onda 1 porque não há diálogo dedicado
implementado, e a regra do projeto é "slot sem jeito de agir nele é pior que nenhum
slot" (`feedback_gatilho_ui_testavel.md`). Já registrado como issue
**xansde/fusion-systems-2e#102** ("Idiomas bônus por Inteligência: picker ausente").
Confirmado que a issue já existe — não reaberta nem duplicada.

## Pendências para issue

1. **xansde/fusion-systems-2e** (nova, aberta nesta lane) — "Exemplar nv1: sem slot de
   rootEpithet, ikon vira 3 slots duplicados". https://github.com/xansde/fusion-systems-2e/issues/104
2. **xansde/fusion-systems-2e** (nova, a abrir) — "Trocar de classe não remove a classe
   anterior (items/features acumulam)". Título sugerido: "Troca de classe pela UI
   acumula class items antigos em vez de substituir". Corpo sugerido: reprodução do
   Achado 1 acima, com o cenário concreto (`Novo Ator`: Barbarian → Exemplar, ambos
   sobrevivem no `world.db`).
3. **xansde/fusion-systems-2e#102** — já existente, sem ação nova; só confirmação de que
   segue válida e cobre o Achado 3.

*(A pendência 2 não foi aberta nesta sessão por não ser escopo direto da Onda 1 — fica
sinalizada aqui para quem fechar a onda decidir se abre antes do PR ou depois.)*

## Encerramento

Servidor (PID do `node ... serve`) encerrado via `taskkill //PID <pid> //F` ao final;
`netstat` confirmou só `TIME_WAIT` restante na porta 33011. Nenhum arquivo do
`~/.fusion` real foi tocado — todo o trabalho ficou em `scratchpad/data-o1`.

## Nota sobre o runbook

`docs/design/ficha-nivel3/gate-runbook.md` estava correto e suficiente para subir o
servidor e logar; não precisou de correção nesta rodada. O único ajuste necessário foi
próprio desta lane (script de seed de atores limpos, descartável, não faz parte do
runbook porque é específico de "preciso de N atores sem classe simultaneamente" — não
generalizável sem mais contexto de produto).
