# Combate montado (Player Core pp. 437, 419, 207, 261)

Fontes AoN: Rules.aspx?ID=2434 (Mounted Combat), 2435 (Mounted Attacks), 2436 (Mounted Defenses), 3417 (Riding Animal Companions), Actions.aspx?ID=2314 (Mount), Feats.aspx?ID=5206 (Ride), Actions.aspx?ID=2400 (Command an Animal); GM Core p. 29 (Rules ID=2562). Vendor: `actions/basic/mount.json`, `feats/general/level-1/ride.json`.

## Regras (formula-level)

| Tema | Regra |
|---|---|
| Mount (1 ação, move) | requisito: adjacente a criatura voluntária **>= 1 tamanho maior** que você. Sobe; se já montado, usa para **desmontar** para espaço adjacente |
| Iniciativa/turno | a montaria age **na sua iniciativa**. Sem Command an Animal ela **desperdiça as ações** |
| Command an Animal | 1 ação, concentrate/auditory; teste de Natureza vs Von da montaria; sucesso = age no próximo turno. **Companheiro animal**: dispensa teste e recebe **2 ações** (regra do companheiro). Montaria comum: 1 ação por ação básica pedida |
| Feat Ride | Command an Animal para ação de movimento sendo montado = sucesso automático; o animal age na sua vez como minion; se você monta no meio do encontro, ele pula o próximo turno e age no seu próximo turno |
| MAP | você e a montaria **compartilham** o penalidade de ataques múltiplos (Strike seu, depois montaria ataca = -5) |
| Espaço/alcance | você ocupa todos os quadrados do espaço da montaria para atacar. Montaria Medium-: alcance normal. Large/Huge: ataca qualquer quadrado adjacente à montaria (alcance 5/10) ou até 10 pés dela (alcance 15). Alcance ajustado vale para flanquear |
| Defesas | atacantes podem escolher você ou a montaria. Área afeta ambos. Alcance/distância contam a partir de qualquer quadrado da montaria. **Cobertura menor** contra ataques contra você se a montaria estiver no caminho (GM) |
| Penalidades do cavaleiro | **-2 circunstância em Reflexo** enquanto montado; a única ação com trait move que você pode usar é Mount (desmontar) |
| Montaria companheira animal | pode ser montada se >= 1 tamanho maior; carregando cavaleiro usa **só Velocidade terrestre** e **não pode mover e Support no mesmo turno** — a habilidade **mount** ignora ambas as restrições (Antílope tem mount) |
| Queda/desmontar à força | sem regra fixa de queda no texto do jogador; GM Core p. 29: se a montaria cair/desmaiar em movimento, sugere Reflexo simples (expert, CD 20); falha = arremessado a curta distância e caído (prone). Dano de queda: regra geral de Falling (Player Core cap. 10), NÃO detalhada aqui — NÃO CONFIRMADO neste levantamento |
| Montaria inteligente | GM Core: usar o mesmo nº de ações para pedir, GM decide (não é o caso aqui) |

## Notas para o Bhrotto
- Leshy é Small: um Antílope Medium é válido como montaria; o Urso (Small) não (mesmo tamanho).
- Com Support do Antílope só enquanto montado (sangramento 1d6 persistente em Strikes do cavaleiro contra criatura no alcance do antílope).
- Leve em conta o -2 em Reflexo no cálculo de CD/saves montado (efeito condicional).

## Vendor
Mount e Ride: rules[] vazio (só prosa). Nenhum predicado de "mounted" codificado nesses dois arquivos.
