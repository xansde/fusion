# 20 — Assets e Mídia

**Status:** draft v0.1
**Data:** 2026-06-11
**Baseada em:**
- `docs/research/90-asset-media-management.md` — estrutura de diretórios, FilePicker API, formatos, S3, TextureLoader, referência de paths, otimização, comparativo VTTs

---

## Objetivo

Definir o subsistema de gerenciamento de arquivos de mídia do Fusion: onde os assets são armazenados em disco, como são enviados ao servidor (upload), quais formatos são aceitos, como são processados (thumbnails, deduplicação, conversão opcional), como são servidos via HTTP, e como o usuário navega e organiza os arquivos pela UI (Asset Browser). Esta spec descreve o subsistema de armazenamento físico e entrega — o consumo dos assets (texturas no canvas, áudio em playlists, etc.) é responsabilidade das specs de subsistemas respectivos.

---

## Escopo

### O que inclui

- Layout em disco da pasta de assets dentro de `fusion-data/` (compartilhada + por world)
- Regras de nomenclatura segura de arquivos (slug + hash, prevenção de path traversal)
- Upload via drag-and-drop e Asset Browser: fluxo HTTP, validação de tipo (magic bytes), limites configuráveis de tamanho, progresso
- Matriz de permissões de storage: quem pode navegar, fazer upload, criar pastas, deletar
- Formatos aceitos: imagens (WebP, PNG, JPEG, SVG), vídeo (WebM, MP4), áudio (delega detalhes a `13-audio-e-playlists.md`), fontes [V2]
- Processamento no upload: validação de magic bytes, cálculo de hash SHA-256, deduplicação por conteúdo, geração de thumbnails, extração de dimensões/duração, conversão opcional para WebP
- Serving estático com Fastify: cache headers corretos, range requests para áudio/vídeo, proteção de path traversal
- Banco de metadados de assets (tabela SQLite `asset_meta` no `assets.db`)
- Asset Browser na UI: grid com preview, busca full-text por nome/tag, navegação por pastas, operações de arquivo (renomear, mover, deletar com verificação de uso), upload inline
- Integração com o restante do sistema: como paths de assets são armazenados em Documents, fallback visual para assets faltantes, path remapping em batch
- Export de world com assets incluídos (ver `03-persistencia-e-mundos.md`)
- S3 / storage remoto como alternativa [V2]

### O que NÃO inclui

- Reprodução e controle de áudio (ver `13-audio-e-playlists.md`)
- Renderização de texturas no canvas PIXI (ver `06-canvas-e-renderizacao.md`)
- Visão, iluminação e fog (ver `07-visao-iluminacao-fog.md`)
- Autenticação de usuários e roles base (ver `05-usuarios-e-permissoes.md`)
- Segurança de rede e TLS (ver `21-seguranca.md`)
- Compendiums e importação de dados do sistema (ver `16-compendiums-e-importacao.md`)
- Upload de pacotes de sistema ou módulos (escopo de instalação/distribuição, ver `22-instalacao-e-distribuicao.md`)
- Fontes customizadas [V2]
- S3 / CDN remoto [V2]
- Sincronização de assets entre múltiplos GMs [V2]

---

## Conceitos e Terminologia

| Termo | Definição |
|---|---|
| **Asset** | Qualquer arquivo de mídia gerenciado pelo subsistema: imagem, vídeo ou áudio. |
| **fusion-data/** | Pasta raiz de dados do Fusion na máquina do GM (ver `03-persistencia-e-mundos.md`). |
| **assets/** | Biblioteca compartilhada de assets acessível a todos os worlds na instalação (em `fusion-data/assets/`). |
| **worlds/\<slug\>/assets/** | Pasta de assets privada de um world específico (em `fusion-data/worlds/<slug>/assets/`). |
| **AssetRef** | String que identifica um asset nos Documents: path relativo a `fusion-data/` (ex.: `assets/tokens/goblin.webp` ou `worlds/the-lost-mine/assets/dungeon.webp`) ou URL absoluta (para assets externos). |
| **Asset slug** | Nome do arquivo sanitizado: ASCII, lowercase, sem espaços, sem caracteres especiais, max 200 chars. |
| **SHA-256 digest** | Hash de conteúdo de 64 caracteres hex calculado no servidor após receber o upload. Usado para deduplicação. |
| **Deduplicação** | Se um arquivo com o mesmo SHA-256 digest já existe, o upload retorna a referência existente sem criar novo arquivo. |
| **Thumbnail** | Imagem WebP de 256×256px (fit: contain, background transparente) gerada pelo servidor com `sharp` no momento do upload. Armazenada em `fusion-data/assets/.thumbs/<digest>.webp`. |
| **asset_meta** | Tabela SQLite no banco `assets.db` (não em `world.db`) que indexa metadados de todos os assets: path, digest, mime-type, dimensões, tamanho, tags. |
| **Magic bytes** | Bytes iniciais de um arquivo que identificam seu tipo real, independente da extensão declarada. |
| **Path traversal** | Ataque onde um path como `../../etc/passwd` tenta acessar arquivos fora da raiz autorizada. |
| **Asset Browser** | Componente de UI Svelte que expõe o subsistema de assets ao usuário: navegação, upload, busca, preview. |
| **Range request** | Requisição HTTP com header `Range` que solicita apenas um trecho do arquivo, essencial para streaming de áudio/vídeo. |

---

## Decisões de Design

### DEC-AST-01: Dois escopos de storage — compartilhado e por world

**Decisão:** O storage de assets é dividido em dois escopos, alinhados ao layout canônico de `fusion-data/` definido em `03-persistencia-e-mundos.md` REQ-PER-001:
1. `fusion-data/assets/` — biblioteca compartilhada da instalação, acessível de qualquer world. Servida em `/assets/` via `@fastify/static`.
2. `fusion-data/worlds/<slug>/assets/` — pasta privada de cada world, inclusa no export `.fwzip`.

**Alternativas rejeitadas:**
- *Storage único global*: assets de worlds diferentes ficariam misturados; ao deletar um world, não haveria como distinguir quais assets são exclusivos dele.
- *Storage exclusivamente por world*: impossibilita reutilização de tokens/mapas entre campaigns; o GM teria que re-fazer upload do mesmo arquivo para cada world.

**Racional:** O modelo dual espelha a distinção do Foundry entre `Data/assets/` (global) e `worlds/<nome>/` (mundo), mas com separação explícita no filesystem e na UI. A tabela `asset_meta` unifica a busca nos dois escopos. O layout sem nível extra de `storage/` é coerente com `03-persistencia-e-mundos.md` REQ-PER-001, que é a especificação canônica do data dir.

---

### DEC-AST-02: Deduplicação por SHA-256 com nome amigável preservado

**Decisão:** No upload, o servidor calcula o SHA-256 do conteúdo. Se já existir um arquivo com esse digest no mesmo escopo (compartilhado ou world), o upload retorna a referência existente sem criar novo arquivo. O arquivo físico mantém o nome slug original do primeiro upload; o digest fica indexado na `asset_meta`. Não é usado CAS puro (arquivo nomeado pelo hash).

**Alternativas rejeitadas:**
- *CAS puro (arquivo = hash)*: deduplicação perfeita, mas o Asset Browser exibiria `a3f8bc...webp` em vez de `goblin-warrior.webp` — UX inaceitável.
- *Sem deduplicação*: modelo do Foundry nativo. Rejeitado por desperdiçar espaço com tokens reutilizados em múltiplas scenes.
- *MD5*: usado pelo MapTool. Rejeitado por colisões conhecidas; SHA-256 é padrão atual sem custo de CPU significativo.

**Racional:** Preservar nome amigável é essencial para UX; o digest como índice invisível fornece deduplicação sem impactar a navegação.

---

### DEC-AST-03: Thumbnails server-side com `sharp`

**Decisão:** Thumbnails são gerados no servidor com `sharp` (binding Node.js para libvips) para imagens estáticas. Para vídeos, a geração de thumbnail via `ffmpeg` é **[V2]** — no MVP, arquivos de vídeo não possuem thumbnail gerado automaticamente; o Asset Browser exibe um ícone genérico por tipo (ver REQ-AST-033). Thumbnails de imagens ficam em `fusion-data/assets/.thumbs/<digest>.webp`, 256×256px, WebP com qualidade 80.

**Alternativas rejeitadas:**
- *Conversão client-side via WebCodecs API*: zero custo de CPU no servidor, mas limita compatibilidade a Chromium/Edge e exige lógica adicional no frontend.
- *`Jimp` (JS puro)*: sem dependência nativa, mas 5-10x mais lento que `sharp` e sem suporte a formatos avançados.
- *Geração sob demanda (lazy)*: adiciona latência na primeira exibição do Asset Browser; thumbnails no upload amortizam o custo.

**Racional:** `sharp` é o padrão de mercado para processamento de imagem em Node.js; roda em todas as plataformas do GM (Windows, macOS, Linux) via binários pré-compilados. O custo de CPU no upload é aceitável para sessões com centenas de tokens pois ocorre apenas uma vez por arquivo único.

---

### DEC-AST-04: AssetRef como path relativo à raiz de storage

**Decisão:** Documents armazenam assets como paths relativos a `fusion-data/` (ex.: `assets/tokens/goblin.webp` ou `worlds/the-lost-mine/assets/maps/dungeon01.webp`). Essa raiz de resolução é a mesma raiz do data dir definida em `03-persistencia-e-mundos.md` REQ-PER-001, garantindo consistência de paths entre as specs. URLs absolutas são armazenadas como string completa e passadas diretamente ao cliente (sem proxy).

**Alternativas rejeitadas:**
- *IDs numéricos de asset_meta*: portabilidade zero — o ID não tem significado fora da instalação.
- *Paths absolutos do filesystem*: quebram em qualquer migração de máquina.
- *URLs absolutas para assets locais*: hardcodado ao IP/domínio do servidor; quebra em LAN vs. internet.

**Racional:** Paths relativos garantem portabilidade no export `.fwzip` e em migrações de máquina. O servidor constrói a URL pública apenas na hora de servir.

---

### DEC-AST-05: Conversão automática para WebP é opt-in configurável

**Decisão:** O servidor NÃO converte automaticamente imagens para WebP por padrão. A conversão pode ser habilitada por configuração (`autoConvertWebp: true` em `fusion.json`). Quando habilitada, PNG e JPEG enviados no upload são convertidos para WebP com qualidade 85 usando `sharp`, e o arquivo original é descartado. SVG nunca é convertido.

**Alternativas rejeitadas:**
- *Conversão obrigatória sempre*: GMs podem ter assets em PNG com transparência crítica ou fluxos de trabalho que dependem dos originais.
- *Conversão apenas para thumbnails*: não aproveita a economia de tamanho para os assets servidos ao cliente.

**Racional:** O opt-in respeita a autonomia do GM. A documentação deve deixar claro que WebP reduz 30-50% o tamanho versus JPEG/PNG em casos típicos.

---

### DEC-AST-06: Cache HTTP agressivo com hash no path

**Decisão:** Assets são servidos com URL que inclui o digest SHA-256 como prefixo de path (ex.: `/assets/a3f8bc.../goblin.webp`) e header `Cache-Control: public, max-age=31536000, immutable`. Quando um asset é substituído (mesmo nome, conteúdo diferente), recebe novo digest e nova URL, invalidando o cache automaticamente.

**Alternativas rejeitadas:**
- *`Cache-Control: no-cache` (modelo Foundry)*: correto mas resulta em round-trips 304 para cada asset em cada cena — inaceitável em LAN residencial de 100 Mbps.
- *Cache agressivo sem hash no path*: assets atualizados não invalidariam o cache do browser.

**Racional:** Content-addressed URLs com `immutable` eliminam praticamente todos os round-trips de revalidação após o primeiro carregamento. O overhead de incluir o digest na URL é negligenciável.

---

### DEC-AST-07: Serving estático via Fastify com `@fastify/static`

**Decisão:** Assets locais são servidos por `@fastify/static` com duas instâncias montadas: `/assets/` apontando para `fusion-data/assets/` (biblioteca compartilhada) e `/worlds/<slug>/assets/` apontando para `fusion-data/worlds/<slug>/assets/` (assets de world, com o slug resolvido na abertura do world). Range requests são suportados pelo plugin out-of-the-box. O plugin é configurado com `dotfiles: 'deny'` para bloquear acesso a `.thumbs/`, `.meta/` e outros diretórios internos.

> **Alinhamento com spec 03:** o layout de serving reflete diretamente o layout de `fusion-data/` de REQ-PER-001 — não há nível extra `storage/` no path de URL nem no filesystem.

**Alternativas rejeitadas:**
- *Proxy via endpoint da API*: adiciona overhead desnecessário para arquivos estáticos grandes.
- *Servir diretamente sem validação de path*: risco de path traversal.

**Racional:** `@fastify/static` já implementa verificação de path confinado à raiz e suporte a range requests; não há razão para reinventar o wheel.

---

### DEC-AST-08: Metadados em SQLite no `assets.db` de instalação (não em world.db)

**Decisão:** As tabelas `asset_meta` e `asset_folder_meta` ficam em `fusion-data/assets.db`, o índice SQLite de instalação da biblioteca de assets compartilhados, não em `world.db`. Isso porque a biblioteca compartilhada de assets pertence à instalação, não a um world. O **layout em disco é canônico na spec 03** (`ver 03-persistencia-e-mundos.md` REQ-PER-001, que lista `assets.db`); esta spec apenas define o **conteúdo** desse banco e o consome/serve.

> **Escopo do `assets.db`:** este banco contém **apenas metadados de assets e pastas** (`asset_meta`, `asset_folder_meta`). Ele NÃO armazena usuários — usuários são por-world e pertencem ao `world.db`, conforme definido em `05-usuarios-e-permissoes.md` e `03-persistencia-e-mundos.md`. É reconstruível a partir do filesystem de `assets/`.

**Alternativas rejeitadas:**
- *Metadados em arquivos sidecar JSON*: impossibilita busca full-text eficiente; fragmentação de dados.
- *Metadados em world.db*: assets compartilhados não pertencem a nenhum world específico; geraria duplicação ou necessidade de um world "global".

**Racional:** Um banco de instalação é a abstração correta para dados que sobrevivem à criação/deleção de worlds individuais. O escopo estreito (apenas assets + config de instalação) evita conflito com o modelo de usuários por-world da spec 05.

---

## Estrutura de Diretórios

```
fusion-data/                 → raiz do data dir (ver 03-persistencia-e-mundos.md REQ-PER-001)
  Config/
    fusion.json              → configuração global do servidor (nome canônico per REQ-PER-001)
  Logs/
  assets/                    → biblioteca compartilhada de assets (servida em /assets/)
    tokens/                  → convenção sugerida (não obrigatória)
    maps/
    audio/
    .thumbs/                 → thumbnails gerados (não servido diretamente ao usuário)
    .meta/                   → arquivos internos (não servido)
  assets.db                  → índice SQLite de instalação dos assets compartilhados
                               (asset_meta, asset_folder_meta — layout canônico na spec 03)
  worlds/
    <world-slug>/
      world.json             → metadados do world (ver 03-persistencia-e-mundos.md)
      world.db               → banco SQLite do world (users, sessions, documents)
      assets/                → assets privados do world (servido em /worlds/<slug>/assets/)
        ...
      backups/
      ...
  compendiums/               → compendium packs globais (ver 03-persistencia-e-mundos.md REQ-PER-001)
```

> **Nota:** Este layout é derivado diretamente de `03-persistencia-e-mundos.md` REQ-PER-001, que é a autoridade canônica do data dir. A spec 20 não altera esse layout — apenas define o comportamento do subsistema de assets dentro dele.

**Regras de nomenclatura:**
- Nomes de arquivo são sanitizados no upload: lowercase, espaços → `_`, caracteres não-ASCII removidos, caracteres especiais (exceto `-`, `_`, `.`) removidos, extensão preservada em lowercase.
- Comprimento máximo do nome: 200 caracteres (antes da extensão).
- Nomes de pasta seguem as mesmas regras.
- O servidor rejeita paths com `..`, `\`, `//`, caracteres nulos ou sequências de codificação URL (`%2e%2e`).

---

## Requisitos Funcionais

### Storage e Estrutura

**REQ-AST-001** [MVP] O servidor DEVE criar automaticamente a estrutura `fusion-data/assets/` e `fusion-data/worlds/<slug>/assets/` na inicialização de uma nova instalação / criação de world, respectivamente, respeitando o layout canônico de `03-persistencia-e-mundos.md` REQ-PER-001.

**REQ-AST-002** [MVP] O servidor DEVE sanitizar nomes de arquivo no upload: converter para ASCII, lowercase, substituir espaços por `_`, remover caracteres especiais (exceto `-_`), truncar em 200 chars antes da extensão.

**REQ-AST-003** [MVP] O servidor DEVE rejeitar qualquer path de asset que contenha `..`, `\`, `//`, `%2e`, `%2f`, caracteres nulos (`\0`) ou qualquer outra sequência que permita sair da raiz de storage.

**REQ-AST-004** [MVP] O servidor DEVE manter a tabela `asset_meta` em `assets.db` com ao menos os campos: `id`, `scope` (`shared` | `world:<slug>`), `path` (AssetRef — relativo a `fusion-data/`), `digest` (SHA-256 hex), `mime_type`, `file_size`, `width`, `height`, `duration_ms` (para áudio/vídeo), `created_at`, `uploaded_by` (user id).

**REQ-AST-005** [MVP] O servidor DEVE criar índices em `asset_meta.digest`, `asset_meta.scope` e `asset_meta.path` para viabilizar buscas e deduplicação em O(log n).

### Upload

**REQ-AST-006** [MVP] O servidor DEVE expor o endpoint `POST /api/storage/upload` com `multipart/form-data`, aceitando os campos `file` (binário), `scope` (`shared` | `world:<slug>`) e `path` (pasta de destino relativa ao escopo).

**REQ-AST-007** [MVP] O servidor DEVE validar o tipo real do arquivo por magic bytes antes de aceitar o upload, independente da extensão declarada ou do `Content-Type` enviado pelo cliente. Formatos validados: WebP (52 49 46 46 ... 57 45 42 50), PNG (89 50 4E 47), JPEG (FF D8 FF), SVG (detecção por BOM/`<svg` no início do texto após sanitização), WebM (1A 45 DF A3), MP4 (ftyp box), OGG (4F 67 67 53), MP3 (49 44 33 ou FF FB/FE/FA).

**REQ-AST-008** [MVP] O servidor DEVE rejeitar uploads cujo tamanho exceda o limite configurado em `fusion.json`. Limites padrão: imagens 50 MB, vídeo 500 MB, áudio 100 MB. O GM pode alterar os limites na configuração.

**REQ-AST-009** [MVP] O servidor DEVE calcular o SHA-256 do conteúdo recebido. Se já existir uma entrada em `asset_meta` com o mesmo `digest` no mesmo `scope`, o servidor DEVE retornar `{ deduplicated: true, path: "<path existente>" }` sem gravar novo arquivo.

**REQ-AST-010** [MVP] O cliente DEVE exibir barra de progresso de upload usando o evento `progress` da requisição XMLHttpRequest / Fetch API. Para uploads acima de 10 MB, o servidor DEVE emitir eventos de progresso via Server-Sent Events ou a barra deve ser estimada pelo tamanho do arquivo.

**REQ-AST-011** [MVP] Somente usuários com permissão `STORAGE_UPLOAD` (role `ASSISTANT` ou superior por padrão) DEVEM poder fazer upload. O servidor DEVE verificar a permissão via JWT antes de aceitar o multipart.

**REQ-AST-012** [MVP] Usuários com role `TRUSTED` PODEM fazer upload somente se a pasta de destino tiver sido marcada pelo GM como `upload_allowed: true` na tabela de metadados de pasta. Por padrão, nenhuma pasta tem esse atributo. Isso permite, por exemplo, liberar uma pasta de avatares de personagem para jogadores.

**REQ-AST-013** [V2] O servidor DEVE suportar upload via URL remota (fetch server-side): o cliente envia `{ url: "https://..." }` e o servidor baixa, valida e armazena o arquivo, deduplicando da mesma forma.

### Processamento no Upload

**REQ-AST-014** [MVP] Para imagens (WebP, PNG, JPEG), o servidor DEVE extrair largura e altura com `sharp` e armazenar em `asset_meta`.

**REQ-AST-015** [MVP] O servidor DEVE gerar thumbnail `256×256` WebP (fit: `contain`, background `#00000000`) usando `sharp` para cada imagem estática única (não deduplicada). Thumbnail armazenado em `fusion-data/assets/.thumbs/<digest>.webp`.

**REQ-AST-016** [MVP] Para SVG, o servidor DEVE sanitizar o conteúdo removendo `<script>`, event handlers inline (`on*`), elementos `<use>` com href externo e qualquer `xlink:href` apontando para URLs não relativas, antes de armazenar. A estratégia de sanitização de SVG DEVE seguir a definida em `21-seguranca.md` (DEC-SEC-06, REQ-SEC-035) como fonte de verdade. Implementação preferida: `sanitize-html` configurado em modo SVG allowlist server-side (que roda nativamente em Node.js sem dependência de DOM). Caso se opte por `DOMPurify`, exige-se provisão de environment DOM via `linkedom` ou `jsdom` como peer-dependency explícita (DOMPurify é DOM-based e não roda em Node.js sem isso).

**REQ-AST-017** [V2] Para vídeo (WebM, MP4), o servidor DEVE tentar extrair o frame do segundo 1 usando `ffmpeg` (via `fluent-ffmpeg`) se disponível no PATH do sistema. Se `ffmpeg` não estiver disponível, o thumbnail de vídeo é omitido sem erro fatal.

**REQ-AST-018** [V2] Quando `autoConvertWebp: true` em `fusion.json`, o servidor DEVE converter PNG e JPEG para WebP com qualidade 85 usando `sharp` antes de armazenar, descartando o original. O campo `mime_type` em `asset_meta` reflete o tipo final armazenado.

### Serving

**REQ-AST-019** [MVP] O servidor DEVE servir os diretórios de assets (`fusion-data/assets/` e `fusion-data/worlds/<slug>/assets/`) via `@fastify/static` com header `Cache-Control: public, max-age=31536000, immutable` para qualquer path que contenha o digest SHA-256 no segmento de URL (ver DEC-AST-07).

**REQ-AST-020** [MVP] O servidor DEVE suportar HTTP range requests (`Range: bytes=N-M`) para todos os assets de áudio e vídeo, respondendo com status 206 e os headers `Content-Range`, `Accept-Ranges: bytes` e `Content-Length` corretos.

**REQ-AST-021** [MVP] O servidor DEVE servir thumbnails da pasta `fusion-data/assets/.thumbs/` na rota `/assets-thumb/<digest>.webp`, com `Cache-Control: public, max-age=31536000, immutable`.

**REQ-AST-022** [MVP] O servidor DEVE rejeitar qualquer tentativa de acesso direto a `assets/.thumbs/` e `assets/.meta/` via as rotas de assets estáticos — esses diretórios são servidos apenas pelas rotas dedicadas.

**REQ-AST-023** [MVP] Para assets não encontrados, o servidor DEVE retornar 404 com body JSON `{ error: "asset_not_found", path: "..." }` em vez de 404 HTML.

**REQ-AST-024** [MVP] O servidor DEVE incluir o header `X-Content-Type-Options: nosniff` em todas as respostas de assets estáticos para prevenir MIME sniffing pelo browser.

### Formatos Suportados

**REQ-AST-025** [MVP] O servidor DEVE aceitar os seguintes formatos de imagem: `image/webp`, `image/png`, `image/jpeg`, `image/svg+xml`.

**REQ-AST-026** [MVP] O servidor DEVE aceitar os seguintes formatos de vídeo: `video/webm`, `video/mp4`.

**REQ-AST-027** [MVP] O servidor DEVE aceitar os seguintes formatos de áudio: `audio/ogg`, `audio/mpeg` (MP3), `audio/webm`, `audio/opus`, `audio/flac`, `audio/wav`. Detalhes de reprodução delegados a `13-audio-e-playlists.md`.

**REQ-AST-028** [V2] O servidor DEVE aceitar fontes no formato `font/woff2`. SVGs usados como fonte NÃO são aceitos por este mecanismo.

### Permissões de Storage

**REQ-AST-029** [MVP] O servidor DEVE implementar três permissões de storage configuráveis pelo GM, com roles padrão:
- `STORAGE_BROWSE`: navegar no Asset Browser — padrão `TRUSTED` (role ≥ 2)
- `STORAGE_UPLOAD`: fazer upload de arquivos — padrão `ASSISTANT` (role ≥ 3)
- `STORAGE_DELETE`: deletar arquivos — padrão `GAMEMASTER` (role = 4)

**REQ-AST-030** [MVP] O GM DEVE poder marcar pastas individuais como `upload_allowed` para estender o direito de upload a usuários com role `TRUSTED` naquela pasta específica. A marcação é feita via endpoint `PATCH /api/storage/folder` e persiste em `asset_meta` (registro de tipo `folder`).

**REQ-AST-031** [MVP] O servidor DEVE verificar permissões em todos os endpoints de storage no lado do servidor, nunca confiar apenas em validações do cliente.

### Asset Browser (UI)

**REQ-AST-032** [MVP] A UI DEVE expor um componente `AssetBrowser` acessível via ícone na barra lateral, com dois painéis: navegação por pastas (árvore) e grid de arquivos (thumbnails).

**REQ-AST-033** [MVP] O `AssetBrowser` DEVE exibir thumbnails para imagens e um ícone genérico com tipo (vídeo, áudio) para formatos sem thumbnail gerado.

**REQ-AST-034** [MVP] O `AssetBrowser` DEVE suportar navegação entre o escopo compartilhado e o escopo do world ativo via abas separadas.

**REQ-AST-035** [MVP] O `AssetBrowser` DEVE aceitar drag-and-drop de arquivos do sistema operacional diretamente na área do grid, iniciando o upload para a pasta atualmente navegada.

**REQ-AST-036** [MVP] O `AssetBrowser` DEVE exibir progresso de upload inline na grade (spinner / barra de progresso por arquivo).

**REQ-AST-037** [MVP] O `AssetBrowser` DEVE suportar busca por nome de arquivo via campo de texto, com resultado filtrado em tempo real no frontend para pastas com menos de 500 itens e via endpoint de busca (`GET /api/storage/search?q=...&scope=...`) para pastas maiores.

**REQ-AST-038** [MVP] Ao selecionar um asset e clicar em "Deletar", o sistema DEVE verificar via endpoint `GET /api/storage/usage?path=...` quantos Documents referenciam aquele path antes de exibir a confirmação. O modal de confirmação DEVE listar o número de referências encontradas (ex.: "Este arquivo é referenciado por 3 documentos. Deletar mesmo assim?").

**REQ-AST-039** [MVP] A operação de deleção DEVE remover o arquivo do disco e a entrada de `asset_meta`. O sistema NÃO atualiza automaticamente Documents que referenciam o path deletado — essa responsabilidade é do usuário (ver REQ-AST-046 para path remapping).

**REQ-AST-040** [MVP] O `AssetBrowser` DEVE suportar criação de subpastas via botão "Nova pasta", validando o nome no frontend antes de enviar ao endpoint `POST /api/storage/mkdir`.

**REQ-AST-041** [V2] O `AssetBrowser` DEVE suportar tags em assets: o usuário pode adicionar/remover tags via modal de detalhes, e a busca pode filtrar por tag.

**REQ-AST-042** [V2] O `AssetBrowser` DEVE suportar visualização em modo lista (além de grid), exibindo nome, tamanho, data de upload e dimensões/duração.

### Integração com Documents

**REQ-AST-043** [MVP] Campos de path de asset em Documents (ex.: `Actor.img`, `Scene.background.src`, `Token.texture.src`) DEVEM armazenar `AssetRef` — string que é um path relativo a `fusion-data/` (ex.: `assets/tokens/goblin.webp` ou `worlds/the-lost-mine/assets/maps/dungeon01.webp`) ou uma URL absoluta iniciando com `https://`.

**REQ-AST-044** [MVP] Ao renderizar um `AssetRef` local, o cliente DEVE construir a URL completa concatenando o host com o path do AssetRef (ex.: `http(s)://<host>/assets/<digest>/<slug>` para assets compartilhados) usando o mapeamento `path → digest` obtido de `asset_meta`. Se o digest não for conhecido pelo cliente (cache miss), o cliente solicita ao servidor via `GET /api/storage/meta?path=...`.

**REQ-AST-045** [MVP] Ao carregar uma cena, o servidor DEVE verificar se todos os `AssetRef` locais referenciados pela scene e por seus tokens existem no filesystem, emitindo um evento socket `scene:asset_warnings` com a lista de paths faltantes antes do primeiro render. O cliente exibe um painel de aviso colapsável.

**REQ-AST-046** [MVP] O GM DEVE ter acesso a um modal de "Remap de paths" acessível pelo Asset Browser: o GM digita um prefixo antigo (ex.: `worlds/old-slug/assets/maps/`) e um novo prefixo; o sistema executa um UPDATE em lote em todos os Documents do world ativo que referenciam paths com o prefixo antigo.

**REQ-AST-047** [MVP] Ao renderizar um token ou tile com `AssetRef` faltante no canvas, o cliente DEVE exibir um placeholder visual claro (ícone de imagem quebrada com borda vermelha) em vez de espaço em branco. O carregamento da cena NÃO deve travar por causa de assets faltantes.

### Catálogo de Placeholders Livres (bundle do Fusion)

> Esta seção atende à dependência declarada pela `16-compendiums-e-importacao.md` (REQ-CMP-031, D8, lista de dependências), que designa a spec 20 como dona do catálogo de ícones livres empacotados e do formato `placeholders.map`. O **placeholder de asset faltante** (REQ-AST-047) e o **catálogo de placeholders temáticos** são conceitos distintos: o primeiro é um fallback de runtime para assets corrompidos/faltantes; o segundo é um conjunto de ícones pré-embutidos para substituição legal durante importação de dados do PF2e/SF2e.

**REQ-AST-048** [MVP] O Fusion DEVE incluir no bundle do cliente (pasta `packages/client/src/assets/placeholders/`) um conjunto de ícones livres de direitos autorais, organizados como catálogo de placeholders para uso pelo importer (`tools/importer-pf2e`). Esta spec é dona do **armazenamento e serving** do catálogo; o **manifesto dos placeholders faltantes/necessários** é gerado pelo importer da spec 16 (`ver 16-compendiums-e-importacao.md` REQ-CMP-033) e orienta a curadoria deste catálogo:

- Fonte primária: **Game-icons.net** (CC BY 3.0) — ícones temáticos para tipos de Document e traits de PF2e.
- Fonte secundária: **Kenney.nl** (CC0) — ícones genéricos e de interface.
- Todos os ícones devem estar no formato **SVG** ou **WebP** (≤ 64×64 px).
- O arquivo `packages/shared/src/assets/placeholders.map.json` DEVE conter o mapeamento declarativo de `(documentType, subtype, trait) → path-do-placeholder-no-bundle`.

**REQ-AST-049** [MVP] O formato do arquivo `placeholders.map.json` DEVE ser:

```typescript
// packages/shared/src/assets/placeholders.map.json (schema)
interface PlaceholdersMap {
  version: string;                              // semver do catálogo
  entries: PlaceholderEntry[];
  fallbacks: Record<string, string>;            // documentType → path genérico
}

interface PlaceholderEntry {
  documentType: string;                         // 'Actor' | 'Item' | 'JournalEntry' | ...
  subtype?: string;                             // ex.: 'weapon', 'spell', 'npc'
  trait?: string;                               // ex.: 'fire', 'arcane', 'humanoid'
  placeholder: string;                          // path relativo ao bundle, ex.: 'placeholders/icons/sword.svg'
  license: 'CC BY 3.0' | 'CC0';
  attribution?: string;                         // obrigatório para CC BY 3.0
}
```

**REQ-AST-050** [MVP] O importer (`tools/importer-pf2e`) DEVE resolver cada referência de arte substituída via `placeholders.map.json`, priorizando a entrada mais específica (`documentType + subtype + trait`) e caindo para o fallback por `documentType` se nenhuma entrada mais específica existir. Ausência de qualquer match NÃO deve falhar o import — usar o placeholder genérico universal (`placeholders/icons/unknown.svg`).

**REQ-AST-051** [MVP] O `placeholders.map.json` DEVE ser versionado junto com o código-fonte no monorepo. Atualizações ao catálogo (adição de novos ícones) DEVEM ser registradas no `CHANGELOG.md` do pacote com a versão semver correspondente.

---

## Requisitos Não-Funcionais

**REQ-AST-052** [MVP] O processamento de upload (validação, hash, deduplicação, thumbnail) para imagens de até 10 MB DEVE completar em menos de 3 segundos em hardware típico de GM (CPU de 4 núcleos, SSD).

**REQ-AST-053** [MVP] O servidor DEVE rejeitar uploads com `Content-Length` declarado acima do limite configurado imediatamente, sem ler o corpo da requisição.

**REQ-AST-054** [MVP] O serving de assets estáticos NÃO DEVE passar pelo loop de eventos do Node.js de forma bloqueante — `@fastify/static` usa streams do Node.js, mantendo o event loop livre.

**REQ-AST-055** [MVP] O servidor DEVE aceitar concorrência de pelo menos 8 uploads simultâneos sem degradação perceptível (fila de workers com `sharp`, não bloquear o event loop).

**REQ-AST-056** [MVP] A busca de assets por nome no `asset_meta` DEVE responder em menos de 200ms para índices com até 10.000 entradas.

---

## Modelo de Dados

### Tabela `asset_meta` (em `assets.db`)

```typescript
interface AssetMetaRow {
  id: number;                          // INTEGER PRIMARY KEY AUTOINCREMENT
  scope: string;                       // 'shared' | 'world:<slug>'
  path: string;                        // AssetRef relativo a fusion-data/ — UNIQUE por scope
  digest: string;                      // SHA-256 hex (64 chars)
  mime_type: string;                   // 'image/webp', 'video/webm', etc.
  file_size: number;                   // bytes
  width: number | null;                // pixels (imagens)
  height: number | null;               // pixels (imagens)
  duration_ms: number | null;          // milissegundos (áudio/vídeo)
  has_thumbnail: boolean;              // true se .thumbs/<digest>.webp existe
  tags: string;                        // JSON array serializado: '["token","goblin"]'
  uploaded_by: string | null;          // user id do uploader
  created_at: string;                  // ISO 8601 UTC
}
```

### Tabela `asset_folder_meta` (em `assets.db`)

```typescript
interface AssetFolderMetaRow {
  id: number;
  scope: string;                       // 'shared' | 'world:<slug>'
  path: string;                        // path da pasta relativo a fusion-data/ (AssetRef de pasta)
  upload_allowed: boolean;             // se TRUSTED pode fazer upload aqui
  created_at: string;
}
```

### Tipos TypeScript do subsistema (`packages/shared`)

```typescript
/** Referência a um asset em um Document */
type AssetRef = string;
// Exemplos válidos:
//   "assets/tokens/goblin.webp"              → asset compartilhado
//   "worlds/the-lost-mine/assets/dungeon.webp" → asset do world
//   "https://example.com/image.webp"          → asset externo (passthrough)

type AssetScope = 'shared' | `world:${string}`;

interface UploadResult {
  path: string;         // AssetRef final
  digest: string;       // SHA-256 hex
  deduplicated: boolean;
  mime_type: string;
  file_size: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  thumbnail_url?: string;
}

interface BrowseResult {
  scope: AssetScope;
  path: string;
  folders: FolderEntry[];
  files: FileEntry[];
}

interface FolderEntry {
  name: string;
  path: string;           // AssetRef relativo a fusion-data/
  upload_allowed: boolean;
}

interface FileEntry {
  name: string;
  path: string;           // AssetRef
  digest: string;
  mime_type: string;
  file_size: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  thumbnail_url?: string;
  tags: string[];
  created_at: string;
}

interface AssetUsageResult {
  path: string;
  references: AssetReference[];
  total: number;
}

interface AssetReference {
  document_type: string;  // 'Actor', 'Scene', etc.
  document_id: string;
  document_name: string;
  field_path: string;     // ex.: 'texture.src'
}

interface AssetSearchOptions {
  query: string;
  scope?: AssetScope;
  mime_types?: string[];
  tags?: string[];
  limit?: number;
  offset?: number;
}
```

---

## API e Eventos

### Endpoints HTTP

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| `GET` | `/assets/<path...>` | `STORAGE_BROWSE` | Serving estático de assets compartilhados |
| `GET` | `/worlds/<slug>/assets/<path...>` | `STORAGE_BROWSE` | Serving estático de assets de world |
| `GET` | `/assets-thumb/<digest>.webp` | `STORAGE_BROWSE` | Serving de thumbnails |
| `GET` | `/api/storage/browse` | `STORAGE_BROWSE` | Lista pasta: `?scope=&path=` |
| `POST` | `/api/storage/upload` | `STORAGE_UPLOAD` | Upload multipart |
| `POST` | `/api/storage/mkdir` | `STORAGE_UPLOAD` | Criar pasta: `{ scope, path }` |
| `DELETE` | `/api/storage/file` | `STORAGE_DELETE` | Deletar arquivo: `{ scope, path }` |
| `GET` | `/api/storage/meta` | `STORAGE_BROWSE` | Metadados de um asset: `?path=` |
| `GET` | `/api/storage/usage` | `STORAGE_BROWSE` | Referências de um asset: `?path=&scope=` |
| `GET` | `/api/storage/search` | `STORAGE_BROWSE` | Busca: `?q=&scope=&mime=&tag=` |
| `PATCH` | `/api/storage/folder` | `GAMEMASTER` | Configurar pasta: `{ scope, path, upload_allowed }` |
| `POST` | `/api/storage/remap` | `GAMEMASTER` | Remap em batch: `{ world_slug, old_prefix, new_prefix }` |

### Eventos Socket.io (servidor → cliente)

| Evento | Payload | Descrição |
|---|---|---|
| `storage:upload_complete` | `UploadResult` | Broadcast ao GM quando upload concluído |
| `scene:asset_warnings` | `{ scene_id: string, missing: string[] }` | Lista de paths faltantes ao ativar scene |

---

## Dependências

| Spec | Relação |
|---|---|
| `03-persistencia-e-mundos.md` | Define `fusion-data/`, `world slug`, `assets.db` (índice de assets de instalação), export `.fwzip` |
| `05-usuarios-e-permissoes.md` | Roles (`PLAYER`, `TRUSTED`, `ASSISTANT`, `GAMEMASTER`), JWT, verificação de permissão |
| `04-rede-e-sincronizacao.md` | Canal socket.io usado pelo evento `storage:upload_complete` |
| `06-canvas-e-renderizacao.md` | Consome `AssetRef` para texturas PIXI; define limites de dimensão de textura |
| `07-visao-iluminacao-fog.md` | Consome `AssetRef` para texturas de tiles/tokens |
| `13-audio-e-playlists.md` | Consome `AssetRef` para faixas de áudio; define formatos de áudio suportados |
| `21-seguranca.md` | Rate limiting de upload, headers de segurança, proteção de path traversal em profundidade |
| `24-operacao-backups-telemetria.md` | Backup dos diretórios de assets (`fusion-data/assets/`, `fusion-data/worlds/<slug>/assets/`) como parte do backup completo da instalação |

---

## Critérios de Aceitação

1. **Upload básico:** GM faz drag-and-drop de um PNG de 5 MB no Asset Browser; o arquivo é recebido, validado, convertido para WebP (se configurado), thumbnail gerado, e aparece na grid em menos de 5 segundos.

2. **Deduplicação:** GM faz upload do mesmo arquivo duas vezes com nomes diferentes; o servidor retorna `deduplicated: true` na segunda vez e nenhum arquivo duplicado é criado no disco.

3. **Path traversal bloqueado:** requisição `GET /assets/../../assets.db` retorna 400 ou 403 sem vazar conteúdo de arquivos fora do diretório de assets autorizado.

4. **SVG sanitizado:** SVG com `<script>alert(1)</script>` é aceito, armazenado sem o elemento `<script>`, e exibido no canvas sem execução de código.

5. **Cache imutável:** ao servir um asset, o header `Cache-Control: public, max-age=31536000, immutable` está presente. Substituir o arquivo (mesmo nome) gera nova URL com novo digest.

6. **Range requests:** player em rede lenta abre cena com áudio de 40 MB; o browser faz requisição com `Range: bytes=0-65535` e recebe resposta 206 com `Content-Range` correto.

7. **Asset faltante graceful:** Scene com token cujo `img` aponta para path inexistente carrega sem travar; o token exibe placeholder vermelho no canvas; painel de aviso lista o path faltante.

8. **Permissões:** usuário `PLAYER` tenta POST em `/api/storage/upload`; servidor retorna 403.

9. **Verificação de uso:** antes de confirmar deleção de um asset usado em 2 tokens, o modal exibe "Este arquivo é referenciado por 2 documentos".

10. **Remap em batch:** GM executa remap de `worlds/old-slug/assets/` para `worlds/new-slug/assets/`; todos os Documents do world ativo que continham o prefixo antigo têm o path atualizado, sem tocar em Documents de outros worlds.

---

## Questões em Aberto

1. **Quota de upload por usuário:** quando pastas são liberadas para `TRUSTED`, deve existir limite de espaço em disco por usuário ou apenas limite por arquivo (via `STORAGE_UPLOAD` max size)? O Foundry não tem esse controle. Definir antes de implementar REQ-AST-012.

2. **Garbage collection de assets órfãos:** assets que foram deletados de todos os Documents mas cujo arquivo físico ainda existe devem ser coletados automaticamente (por job periódico) ou apenas sob demanda? Qual a frequência aceitável do scan?

3. **Streaming de vídeo com seek preciso:** range requests básicos são suficientes para a maioria dos vídeos de cena animada. Mas para vídeos muito longos (>5 min), seek preciso requer índice moov no início do MP4. O servidor deve pré-processar MP4 com `ffmpeg -movflags faststart`? Definir antes de implementar REQ-AST-026.

4. **Thumbnails para áudio:** o Asset Browser deve exibir waveform (forma de onda) como thumbnail para arquivos de áudio? Isso requer decodificação do áudio com `ffmpeg` no upload. Alternativa: ícone estático por formato.

5. **Import de mundo com assets externos:** ao importar um `.fwzip` que referencia URLs externas (`https://...`) em seus Documents, o Fusion deve oferecer a opção de baixar e re-hospedar esses assets localmente? Isso tem implicações de direitos autorais.

6. **Tamanho máximo de thumbnail:** 256×256 é suficiente para o grid do Asset Browser em monitores 4K (DPI alto)? Considerar gerar dois tamanhos (256 e 512) e servir via `srcset`.

7. **Sincronização de assets entre GMs co-autores:** fora do escopo do MVP e marcado como [V2] em múltiplas specs, mas requer definição de protocolo antes de desenhar a estrutura de pastas para que seja extensível.

---

## Referências

- `docs/research/90-asset-media-management.md` — pesquisa primária deste subsistema
- [Asset Management | Foundry Virtual Tabletop](https://foundryvtt.com/article/asset-management/)
- [Media Optimization Guide | Foundry Virtual Tabletop](https://foundryvtt.com/article/media/)
- [sharp — Node.js image processing](https://sharp.pixelplumbing.com/)
- [fluent-ffmpeg — Node.js wrapper for ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg)
- [@fastify/static](https://github.com/fastify/fastify-static)
- [sanitize-html — Node.js HTML sanitizer (preferido para server-side SVG)](https://github.com/apostrophecms/sanitize-html)
- [DOMPurify — XSS sanitizer (DOM-based; requer linkedom/jsdom em Node.js)](https://github.com/cure53/DOMPurify)
- [linkedom — DOM polyfill para Node.js (se DOMPurify for escolhido)](https://github.com/WebReflection/linkedom)
- [MapTool — MD5 content-addressed asset cache](https://forums.rptools.net/viewtopic.php?t=17509)
- `03-persistencia-e-mundos.md`
- `05-usuarios-e-permissoes.md`
- `13-audio-e-playlists.md`
- `21-seguranca.md`
