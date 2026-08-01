# Contribuindo com o Fusion

Obrigado pelo interesse. Este documento cobre o essencial para que uma contribuição entre sem atrito.

## Antes de começar

Leia as [regras do projeto no README](README.md#regras-do-projeto). A mais importante: **clean-room**. Não copie código, assets ou textos proprietários do Foundry VTT. Estudar comportamento e documentação pública é permitido; código do repositório `foundryvtt/pf2e` (Apache-2.0) pode ser referência, com atribuição no comentário.

As [`specs/`](specs/README.md) são a fonte de verdade. Se a implementação diverge da spec, o correto é discutir a spec — não silenciar a divergência no código.

## Fluxo

1. Abra uma issue descrevendo o problema ou a proposta antes de escrever código, especialmente para mudanças não triviais. Alinhar o desenho antes economiza retrabalho.
2. Crie a branch a partir de `build/app` (a branch de integração).
3. Faça a mudança, com testes.
4. Rode os gates localmente (abaixo).
5. Abra o PR contra `build/app`, descrevendo o que mudou e por quê.

PRs pequenos e revisáveis são preferíveis a um PR grande. Um diff enorme não recebe review de verdade.

## Gates

O CI roda estes comandos, nesta ordem. Rode-os antes de abrir o PR:

```bash
pnpm build
pnpm typecheck
pnpm format:check
pnpm lint
pnpm lint:boundaries
pnpm test
```

`pnpm format` e `pnpm lint --fix` corrigem automaticamente a maior parte do que o format check e o lint apontam.

Um detalhe sobre os testes do servidor: eles rodam em pool `forks` com `maxForks 4`, porque o `better-sqlite3` quebra em worker threads. Se a suíte sair com código diferente de zero exibindo `Timeout calling "onTaskUpdate"` **sem nenhum teste falhando**, isso é instabilidade de infraestrutura do vitest sob carga — rode o arquivo isolado antes de tratar como regressão.

## Convenções

- **Código, comentários e identificadores em inglês.** Documentação e specs em pt-BR.
- **Conventional commits**: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`.
- TypeScript estrito. O ESLint roda com `strictTypeChecked` — asserções não-nulas (`!`) e casts largos tendem a ser barrados; prefira estreitar o tipo de verdade.
- Requisitos das specs são referenciados como `REQ-<PREFIXO>-NNN` nos comentários.

## Pontos de arquitetura que o review vai cobrar

- **O servidor é autoritativo.** Rolagens executam no servidor; toda validação de permissão acontece no servidor. Não mova decisão de regra para o client.
- **Redação de visibilidade** (tokens escondidos, roll modes) usa sempre `packages/server/src/net/redaction.ts` e o `isRolePrivileged` de `documents/ownership.ts`. Não duplique predicados nem lógica de strip.
- **Sistemas de jogo são pacotes compilados** do monorepo. Não há plugin dinâmico no MVP.
- **Join de conteúdo de compêndio** é sempre por nome normalizado — `slug` não existe nos dados.

## Testes

Teste comportamento, não implementação. Código de produção novo (funcionalidade, correção de bug, endpoint, função de regra) entra com teste. Script exploratório e prova de conceito descartável, não.

## Reportando bugs

Inclua: o que você esperava, o que aconteceu, como reproduzir, e o sistema de jogo/mundo envolvido. Log do servidor ajuda muito — ele sai em JSON estruturado no stdout.
