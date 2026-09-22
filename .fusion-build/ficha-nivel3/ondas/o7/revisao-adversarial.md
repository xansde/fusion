# Revisão adversarial da Onda 7: parecer do juiz

**Veredito: REPROVADA.** São 12 achados confirmados: 1 bloqueante de processo, 7 importantes e 4 menores. Nenhum achado foi refutado; as 23 entradas das lentes se reduziram a 12 depois de juntar as duplicatas.

Como verifiquei (só leitura, na wt-c):
- Li `moldeComparator.ts`, `classBuildHarness.ts:630-660`, `characterSheetVM.ts:1017-1057`, `derivations/character.ts:520-560`, `planVM.ts:2780-2811`, `character-templates.json`, `tasks.md:203-206`, o spec do roteiro e as legendas do HTML.
- Abri o print 23 (`prints/roteiro-print-23.png`).
- Conferi o diretório `roteiros/` no repo principal e o estado da issue fusion-systems-2e#144.

## Confirmados

| id | sev | achado | dono | conserto |
|---|---|---|---|---|
| C1 | bloqueante | O dado do ator nunca foi conferido com os prints. O check da evidência viva está falho, e a T7.3 só abriu o world.db para o #254 (se o Actor existe), não para build.choices, ranks nem HP. O data-dir `data-o7` está vazio. | core: lane de evidência + roteiro | Rodar o roteiro de novo guardando o data-dir, extrair `system` do ator (saves/perception rank, build.choices, hp) e confrontar com os prints. |
| C2 | importante | O comparador ignora o chassi do molde. `buildCharacterToLevel` monta Ratfolk + Aeronaut sem dádivas, e nada lê `metadata.chassis_common`. Com o molde preenchido, toda célula diverge por causa do harness, e uma coincidência numérica dá verde falso. | satélite `__tests__/helpers/moldeComparator.ts:116-160` + `classBuildHarness.ts:648-649` | Montar a partir do chassi do molde (ancestralidade, herança, background, dádivas) e deixar pendente enquanto o chassi estiver como "proposta". |
| C3 | importante | O comparador só confronta hp, ca e as 3 salvaguardas. proficiencies, trained_skills, granted_feats, focus_pool, spells e languages do molde nunca são comparados. Isso corta o escopo da T7.2 (tasks.md:203-204). | satélite `moldeComparator.ts` | Comparar todos os campos da T7.1. Campo nulo fica pendente, e campo preenchido conta como comparado. |
| C4 | importante | O chassi proposto é ilegal e deixa a ficha em aberto: INT 13 e CAR 11 não saem de dádivas, e faltam herança, perícias do Scholar e da classe, talento de ancestralidade e idiomas. O builder não consegue reproduzir o molde. | core `docs/design/ficha-nivel3/molde/character-templates.json` + `README-molde.md` | Usar modificadores ou valores pares alcançáveis e fixar herança, escolhas de perícia, talento de ancestralidade e idioma. |
| C5 | importante | A ficha do e2e não segue o chassi: dádivas, Musa, perícias (0/4), talento de ancestralidade e idioma ficam em aberto, e o resultado é PV 16/24/32 e CA 13/14/15 com modificadores zerados. Mesmo assim, as legendas dos passos 14/20 dizem que "fecha o aceite não-circular", e o relatório diz "tudo condiz". | core `.claude/skills/tutorial-e2e/roteiros/ficha-nivel3.spec.ts` + `docs/design/ficha-nivel3/onda7/roteiro-e2e-ficha-nivel3.html` | Aplicar o chassi completo e gerar o HTML de novo. Se não der, trocar as legendas e o relatório para "prova de fluxo, não comparável ao molde". |
| C6 | importante | O spec `ficha-nivel3.spec.ts` só existe na wt-c. O `roteiros/` do repo principal não tem o arquivo, então o fecho apaga o roteiro que a T7.4 precisa rodar. | core `.claude/skills/tutorial-e2e/roteiros/` | Copiar para o repo principal antes de remover a wt-c. |
| C7 | importante | O smoke rodou só como Mestre. PROCESSO-UI P4 (smoke também como player) e a criação pelo jogador (O6, REQ-USR-025) não foram exercitados, e o GM passa por cima dos gates de ownership e `vm.editable`. | core: roteiro | Acrescentar uma seção de player: o dono loga, monta a ficha nível 1→3 e o print mostra o slot de arquétipo e a subida de nível. |
| C8 | importante | O selo de proficiência das salvaguardas e da Percepção lê o rank persistido (0), enquanto o total usa o rank vindo da classe. O print 23 mostra Fort +5 U, Ref +7 U e Von +7 U num Bard nv3 (Treinado / Expert / Expert). O defeito é anterior à onda, mas está visível nos prints do aceite e não foi registrado. | satélite `sheets/pf2e/.../characterSheetVM.ts:1017-1057` | Tirar `rank` da mesma fonte preparada que alimenta o total e cobrir com teste. Abrir issue caso não seja consertado nesta onda. |
| C9 | menor | O aceite mostra como válida a Acrobat Dedication sem Acrobacia treinada: foi a primeira linha do picker, aparece com ✓ e sem aviso. A lacuna de mecanismo já está registrada (fusion-systems-2e#144, aberta). | core: roteiro (spec:173-180) | Treinar Acrobacia no chassi ou escolher uma dedicação cujo pré-requisito a ficha cumpre, e citar a #144 na legenda. |
| C10 | menor | A legenda do passo 07 diz que o Actor aparece em "Na mesa" assim que o usuário é criado, o que contradiz o `gm.reload()` e a #254. | core: HTML/spec | Reescrever: "aparece após recarregar (#254)". |
| C11 | menor | O spec não tem nenhum `expect`, e a frase "nenhuma de multiclasse deve aparecer" (passo 17) não é verificada. | core: spec | Afirmar que não há dedicação de multiclasse na lista filtrada e colocar asserções nos números-chave. |
| C12 | menor | A legenda do nv3 diz "Repertório espontâneo e pool de foco", mas o print 23 para em "PATAMAR 1 3/3": o repertório está vazio, e a aba Foco e o Patamar 2 não aparecem. | core: roteiro | Rolar até o Patamar 2, abrir a aba Foco e a aba Perícias, e fotografar. |

## Fora dos achados
O pin do core apontando para a branch de feature do satélite é o estado normal, e a ausência do Alexandre não conta como achado. Nenhuma decisão de escopo delegada foi julgada errada.
