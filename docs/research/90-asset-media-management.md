# Gerenciamento de Assets e Arquivos de Mídia — Fusion VTT

> Documento de pesquisa para subsidiar a spec do subsistema de arquivos do Fusion VTT.
> Não repete conteúdo dos docs 03 (canvas/formatos de imagem para renderização) nem 06 (hosting/rede).
> Foco: subsistema de file management — upload, storage, serving, referências, otimização.

---

## 1. O Subsistema de Arquivos do Foundry VTT

### 1.1 Estrutura de Diretórios (User Data)

O Foundry VTT organiza todos os dados do usuário dentro de uma pasta chamada **User Data**, cujo caminho varia por plataforma:

| Plataforma | Caminho padrão                             |
| ---------- | ------------------------------------------ |
| Windows    | `%localappdata%/FoundryVTT`                |
| macOS      | `~/Library/Application Support/FoundryVTT` |
| Linux      | `~/.local/share/FoundryVTT`                |

Dentro de User Data, três subdiretórios principais:

```
UserData/
  Config/          → options.json e arquivos de configuração (ex.: aws.json)
  Logs/            → logs do servidor Node.js
  Data/            → todo o conteúdo jogável e assets
    systems/       → sistemas de jogo instalados
    modules/       → módulos add-on instalados
    worlds/        → dados dos mundos (LevelDB + assets do mundo)
    assets/        → pasta criada automaticamente (v13+) para uploads do usuário
```

O subdiretório `Data/` é a raiz pública servida pelo servidor Express. Todo arquivo dentro de `Data/` se torna acessível via URL relativa. Por exemplo:

```
UserData/Data/worlds/minha-campanha/maps/dungeon01.webp
→ URL: worlds/minha-campanha/maps/dungeon01.webp
```

Além do User Data, existe o **Core Data** (ícones e assets do próprio Foundry), que é somente-leitura e não aceita uploads pelo usuário.

### 1.2 Serving de Assets Estáticos

O servidor Express do Foundry serve o diretório `Data/` como raiz estática. O servidor usa `Cache-Control: no-cache` (introduzido aproximadamente na v11.302), o que força um round-trip 304 (ETag/Last-Modified) a cada requisição — evita cache stale mas aumenta a latência em conexões lentas. Não há content-hashing nativo nos nomes de arquivo. O cache-busting é feito via query string (`?v=<timestamp>`) quando necessário pela lógica do cliente.

O Foundry não implementa CDN ou compressão gzip nativa nos assets estáticos — essa responsabilidade cabe ao operador (nginx reverso, Cloudflare, etc.).

### 1.3 Upload Restrictions (v13+)

A partir da versão 13, o Foundry passou a proibir uploads via FilePicker em determinadas localizações protegidas:

- Raiz de `Data/`
- `Data/systems/`, `Data/modules/`, `Data/worlds/` (top-level)
- Subpastas de sistemas/módulos instalados (exceto quando o manifesto libera)
- Diretórios de outros mundos além do ativo

A lógica de proteção é implementada no lado do servidor: o endpoint de upload rejeita requisições para caminhos bloqueados. A proteção não impede uploads diretos via sistema de arquivos (SFTP, acesso ao disco) — apenas via API do Foundry.

**Exceção controlável:** o manifesto de cada pacote (`world.json`, `system.json`, `module.json`) pode incluir:

```json
"flags": { "canUpload": true }
```

Quando presente e `true`, o servidor permite uploads dentro da pasta daquele pacote. A omissão equivale a `false`.

A pasta `Data/assets/` criada automaticamente na v13 é sempre gravável pelo usuário. Ela foi introduzida precisamente para dar um destino óbvio para uploads, reduzindo a confusão causada pelo botão de upload desabilitado na raiz.

---

## 2. FilePicker — API e Comportamento

### 2.1 Visão Geral

O `FilePicker` é a aplicação de UI que expõe o subsistema de arquivos ao usuário e aos desenvolvedores. Na v14 ele estende `ApplicationV2` com mixin `HandlebarsApplication`. A interface oferece quatro modos de visualização: lista, thumbnail, tiles e imagens (previews grandes).

### 2.2 Fontes de Storage (sources)

O FilePicker suporta três fontes configuráveis:

| Source     | Descrição                                               |
| ---------- | ------------------------------------------------------- |
| `"data"`   | Diretório interno `Data/` (User Data)                   |
| `"public"` | Pasta pública do servidor (raramente usada diretamente) |
| `"s3"`     | Buckets Amazon S3 ou compatíveis (quando configurado)   |

A fonte ativa é controlada por `activeSource`. Ao navegar pelo FilePicker, o usuário pode trocar de tab entre as fontes disponíveis.

### 2.3 Métodos da API

```typescript
// Navegar para um diretório
FilePicker.browse(source: string, target: string, options?: {
  bucket?: string,
  extensions?: string[],
  wildcard?: boolean
}): Promise<{ dirs: string[], files: string[], ... }>

// Fazer upload de um arquivo
FilePicker.upload(
  source: string,
  path: string,
  file: File,
  body?: object,
  options?: object
): Promise<{ path: string, ... }>

// Criar subdiretório
FilePicker.createDirectory(
  source: string,
  target: string,
  options?: object
): Promise<object>

// Configurar metadados de path
FilePicker.configurePath(
  source: string,
  target: string,
  options?: object
): Promise<object>
```

O `upload()` envia o arquivo via `POST` multipart/form-data para o servidor. A resposta contém o path final do arquivo (que pode diferir do solicitado se houver normalização de nome).

### 2.4 Permissões

As permissões de arquivo são configuradas por mundo, no painel de Game Settings. Os valores relevantes no objeto `CONST.USER_PERMISSIONS` são:

| Constante      | Role padrão        | Descrição                        |
| -------------- | ------------------ | -------------------------------- |
| `FILES_BROWSE` | 2 (Trusted Player) | Permite navegar no FilePicker    |
| `FILES_UPLOAD` | 3 (Assistant GM)   | Permite fazer upload de arquivos |

Roles: 1 = Player, 2 = Trusted Player, 3 = Assistant GM, 4 = Gamemaster.

Por padrão, jogadores comuns (role 1) não podem nem navegar nem fazer upload. O GM pode rebaixar o threshold para qualquer role no painel de permissões.

As permissões são verificadas no servidor a cada requisição de upload/browse — não é apenas validação client-side.

---

## 3. Formatos Suportados e Recomendados

### 3.1 Imagens

| Formato         | Suporte | Recomendação                                                              |
| --------------- | ------- | ------------------------------------------------------------------------- |
| WebP            | Sim     | **Recomendado** — melhor relação qualidade/tamanho, suporta transparência |
| AVIF            | Sim     | Qualidade superior ao WebP, suporte mais limitado em navegadores antigos  |
| PNG             | Sim     | Para imagens pequenas ou quando transparência é crítica                   |
| JPEG            | Sim     | Para fundos de cenas grandes onde transparência não é necessária          |
| SVG             | Sim     | Para gráficos vetoriais simples (ícones, UI)                              |
| GIF             | Sim     | Obsoleto — desaconselhado, usar WebM para animações                       |
| BMP, TIFF, APNG | Sim     | Suportados mas não recomendados para produção                             |

**Dimensões para tokens:** 400×400px para criaturas médias/grandes (range 200–400px). Tokens devem ser orientados para o sul (frente voltada para baixo) e precisam suportar transparência (WebP ou PNG).

**Limite prático para texturas de cena:** 8.000px por dimensão em hardware mais antigo; 16.000px em hardware moderno. Acima disso o carregamento falha silenciosamente em alguns browsers.

### 3.2 Vídeo

| Formato | Suporte | Recomendação                                                         |
| ------- | ------- | -------------------------------------------------------------------- |
| WebM    | Sim     | **Recomendado** — suporta transparência (canal alpha), menor tamanho |
| MP4/M4V | Sim     | Amplamente compatível, codec h264 com VBR                            |
| OGV     | Sim     | Compatibilidade legada                                               |

**Diretrizes:** máximo 30fps; ~50MB por arquivo para distribuição; bitrate constante 2–5Mbps ou VBR; qualidade 60–80%. Vídeos com áudio devem separar a trilha de áudio em arquivo dedicado.

### 3.3 Áudio

| Formato | Suporte | Recomendação                                                |
| ------- | ------- | ----------------------------------------------------------- |
| OGG     | Sim     | **Recomendado** — loop limpo, menor tamanho (exceto Safari) |
| MP3     | Sim     | Compatibilidade universal, não faz loop limpo               |
| FLAC    | Sim     | Lossless para masters; arquivos grandes                     |
| WEBM    | Sim     | Otimizado para web, sem suporte Safari                      |
| OPUS    | Sim     | Alta qualidade em bitrates baixos                           |
| WAV     | Sim     | Não recomendado para produção (arquivos enormes)            |
| AAC/M4A | Sim     | Suportados                                                  |
| MIDI    | Sim     | Suportado                                                   |

**Bitrate recomendado:** 128kbps mínimo, 192kbps ideal. A conversão deve ser feita apenas uma vez a partir de source lossless (WAV/FLAC), pois recomprimir formatos já comprimidos degrada a qualidade.

---

## 4. Integração S3 e CDN

### 4.1 Configuração Nativa

O Foundry possui suporte nativo a S3 (AWS e APIs compatíveis). A configuração é feita em `options.json` apontando para um arquivo JSON separado ou inline:

```json
{
  "aws": "Config/aws.json"
}
```

Onde `Config/aws.json` contém:

```json
{
  "buckets": ["nome-do-bucket"],
  "region": "us-east-1",
  "credentials": {
    "accessKeyId": "AKIAXXXXXXXX",
    "secretAccessKey": "XXXXXXXXXXXXXXXX"
  }
}
```

Quando configurado corretamente, os buckets aparecem como uma nova tab/source no FilePicker, ao lado de "data" e "public".

### 4.2 Requisitos de CORS

O bucket S3 deve ter uma CORS policy configurada para aceitar requisições do domínio do Foundry:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "POST", "HEAD"],
    "MaxAgeSeconds": 3000
  }
]
```

**Limitação importante:** o Foundry atualmente exige que os buckets sejam públicos (`public-read` ACL). Não há suporte nativo a signed URLs ou presigned URLs para acesso privado. Arquivos confidenciais não devem ser armazenados em buckets configurados para o Foundry.

### 4.3 Modelo de Entrega de Assets com S3

Com S3 configurado, o fluxo de entrega muda drasticamente:

**Sem S3 (local):**

```
Jogador → [internet] → Servidor GM (upload residencial) → assets servidos pelo Express
```

**Com S3:**

```
Upload: GM → [internet] → S3 bucket
Entrega: Jogador → [CDN/S3 endpoint] → assets (não passa pelo GM)
```

Isso resolve o gargalo de bandwidth de upload residencial documentado no doc 06. O servidor do GM não participa da entrega dos assets — apenas referencia as URLs públicas do bucket.

### 4.4 Alternativas S3-Compatíveis

A comunidade usa buckets S3-compatíveis como alternativas mais baratas ou com CDN embutida:

| Serviço             | Vantagem                      | Configuração extra                   |
| ------------------- | ----------------------------- | ------------------------------------ |
| Cloudflare R2       | Sem egress fees, CDN embutida | Precisa de access key R2             |
| Backblaze B2        | Muito barato                  | Precisa de Cloudflare como proxy CDN |
| MinIO (self-hosted) | Controle total, on-premise    | Servidor adicional necessário        |

### 4.5 The Forge (plataforma de hosting)

The Forge, a principal plataforma de hosting para Foundry, implementa sua própria Asset Library em cima de S3 com replicação em 50+ servidores globais via CDN. Adiciona compressão automática (serve WebP quando o browser suporta) reduzindo tamanho de carregamento em mais de 50%. Isso demonstra como um Fusion hospedado publicamente deveria funcionar.

---

## 5. TextureLoader e Gerenciamento de Texturas no Cliente

### 5.1 Arquitetura

O Foundry usa um `TextureLoader` customizado (construído sobre PIXI.Assets após a v12) para gerenciar texturas no canvas. Principais responsabilidades:

- **Carregamento sob demanda** (`loadTexture(url)`): lazy loading de texturas individuais
- **Carregamento em lote** (`load([urls], { maxConcurrent })`): carrega múltiplas URLs com concorrência configurável
- **Carregamento de cena** (`loadSceneTextures(scene)`): carrega todas as texturas necessárias para uma cena antes de exibi-la

### 5.2 Sistema de Cache Multi-camada

O TextureLoader mantém cache em memória com:

- `getCache(url)`: retorna `PIXI.BaseTexture` ou spritesheet, ou `null`
- `setCache(url, texture)`: armazena com cálculo aproximado de uso de memória
- `expireCache(ttl, excludeSet)`: expira texturas não-usadas após `CACHE_TTL` ms
- `approximateTotalMemoryUsage`: expõe consumo total de memória do cache em bytes
- `pinSource(url)` / `unpinSource(url)`: previne evicção de URLs específicas do cache

### 5.3 Cache-Busting

O `TextureLoader` implementa `getCacheBustURL()` que adiciona query string de timestamp à URL para forçar recarregamento. A opção `bustCache` pode ser passada no load. Há um bug documentado (issue #9723) em que `getTexture()` retorna null se a textura foi carregada originalmente com cache-busting — a URL com query string não bate a URL sem query string no índice do cache.

### 5.4 Lazy Loading

Texturas são carregadas sob demanda conforme entidades entram no viewport. URLs começando com `#` são ignoradas como referências de textura (tratamento especial para referências internas). O carregamento de cena progride com barra de progresso e pode ser configurado em concorrência para gerenciar bandwidth.

### 5.5 Tratamento de Erros (Missing Assets)

O Foundry não possui fallback sofisticado para assets faltantes:

- **Imagem de background faltante:** cena exibe a `Scene Background Color` configurada (geralmente cinza ou preto) — sem placeholder visual indicando o erro
- **Token/tile faltante:** exibe ícone de imagem quebrada padrão do browser
- **Diagnóstico:** a documentação recomenda verificação manual do path correto via FilePicker e inspecionar o console do browser para erros `Failed to fetch`
- **Vídeos:** cenas com vídeos WebM podem travar no carregamento (87–98% de progresso) em alguns browsers — workaround documentado é refresh da página

---

## 6. Referência de Paths em Documents

### 6.1 Paths Relativos vs. Absolutos

O Foundry armazena paths de assets nos Documents (Actor, Scene, Item, etc.) como **paths relativos à raiz do diretório `Data/`**. Por exemplo:

```json
{
  "img": "worlds/minha-campanha/tokens/goblin.webp"
}
```

Não são usadas URLs absolutas (sem `http://`/`https://`) para assets locais. Para assets S3, a URL completa é armazenada.

Essa convenção tem implicações importantes:

- **Portabilidade:** paths relativos funcionam independente de IP/domínio do servidor
- **Import/export:** ao mover um mundo, os paths só funcionam se a estrutura de diretórios for preservada
- **Backup:** os assets em si não são incluídos no backup de mundo — apenas as referências ficam no banco LevelDB

### 6.2 Problema de Paths em Import/Export

O maior ponto de dor documentado na comunidade é o **path remapping** durante import/export:

- Um mundo exportado contém paths como `systems/pf2e/icons/creatures/goblin.webp` (assets do sistema)
- Ao importar em outro servidor, esses assets podem não existir se o sistema não estiver instalado
- Assets em `worlds/<nome>/` são relativos ao mundo — se o nome do mundo mudar, os paths quebram

**Módulo Adventure Bundler** (comunidade) resolve isso ao exportar:

1. Scan de todos os Documents para extrair URLs de assets
2. Exclusão de assets do core, sistemas instalados e URLs externas
3. Compressão dos assets restantes em ZIP junto com os dados do mundo
4. No import, upload automático dos assets para o diretório configurado

### 6.3 Recomendação do Foundry para Desenvolvedores de Pacotes

O Foundry recomenda fortemente que autores de módulos e sistemas criem conteúdo (Scenes, Actors, Items) a partir da pasta do módulo desde o início, para que os paths gerados automaticamente sejam `modules/meu-modulo/assets/...` e permaneçam corretos após publicação.

### 6.4 Impacto em Backup

A documentação oficial afirma explicitamente: **"multimedia assets are likely not included when you take a backup"**. Apenas os dados do mundo (LevelDB) são incluídos no backup interno. Assets em `worlds/<nome>/maps/` ficam de fora do backup padrão se não estiverem no mesmo zip de exportação. A recomendação é fazer backup do User Data completo externamente.

---

## 7. Otimização de Assets

### 7.1 Estratégias Server-Side

**Compressão no upload (via módulos da comunidade):**

O módulo **Media Optimizer** (TheRipper93, pago) converte automaticamente arquivos no momento do upload:

- Imagens → WebP (compressão padrão 0.75, max 8K)
- Vídeo → WebM
- Áudio → OGG

Funciona apenas em browsers Chromium e no Electron app do Foundry. Usa a Web API nativa do browser para conversão client-side antes de enviar ao servidor.

O módulo **Geano's Scene Optimizer** usa a **WebCodecs API** para processamento multi-thread offline no browser, convertendo backgrounds para WebP e áudio para OGG/Opus — sem dependências externas no servidor.

**Observação:** o Foundry nativo não faz nenhuma transformação server-side no upload. O arquivo é armazenado exatamente como enviado.

### 7.2 Thumbnails

Thumbnails de cenas são geradas pelo Foundry usando PIXI para renderizar uma preview do canvas. A geração pode falhar em cenas com assets muito grandes ou faltantes. O módulo **Origin Vault** adiciona geração de thumbnails para assets genéricos (imagens, vídeos, áudios, cenas) na biblioteca de assets.

Thumbnails não são gerados automaticamente para cada arquivo — apenas para cenas no setup e sob demanda via módulos.

### 7.3 Deduplicação por Conteúdo

O Foundry **não implementa** content-addressed storage ou deduplicação por hash nativamente. Dois uploads do mesmo arquivo com nomes diferentes criam dois arquivos distintos no filesystem.

**MapTool** é um exemplo de VTT open-source que implementa deduplicação via MD5: cada asset é identificado pelo hash MD5 do seu conteúdo (o "Asset Code"). O asset cache local usa esses hashes como chaves, e o servidor só transfere assets que o cliente ainda não tem. Isso elimina redundância em campaigns onde o mesmo token é usado múltiplas vezes.

### 7.4 Cache HTTP

O Foundry usa `Cache-Control: no-cache` para assets estáticos, o que resulta em round-trips 304 frequentes. Em instalações com Cloudflare ou nginx na frente, é comum configurar cache agressivo para assets imutáveis (ex.: `Cache-Control: public, max-age=31536000, immutable`) para arquivos cujo nome inclui hash de conteúdo.

---

## 8. Comparativo: Foundry vs. Owlbear Rodeo vs. MapTool

### 8.1 Modelo de Storage

| Aspecto          | Foundry VTT                    | Owlbear Rodeo         | MapTool                 |
| ---------------- | ------------------------------ | --------------------- | ----------------------- |
| Storage primário | Filesystem local (User Data)   | Cloud (backend SaaS)  | Filesystem local (Java) |
| S3 nativo        | Sim (opcional)                 | Não necessário (SaaS) | Não                     |
| CDN              | Via S3 externo                 | Automática (SaaS)     | Não                     |
| Deduplicação     | Não                            | Não documentado       | Sim (MD5 hash)          |
| Assets portáteis | Parcialmente (paths relativos) | Sim (cloud)           | Problema histórico      |

### 8.2 Upload e Organização

| Aspecto               | Foundry VTT               | Owlbear Rodeo               | MapTool                  |
| --------------------- | ------------------------- | --------------------------- | ------------------------ |
| Upload via UI         | Sim (FilePicker)          | Sim (UI nativa)             | Sim (Resource Library)   |
| Organização           | Pastas no filesystem      | Pastas + tags               | Resource Library         |
| API de upload         | `FilePicker.upload()`     | `OBR.assets.uploadImages()` | Não exposta publicamente |
| Permissões granulares | Por role de usuário       | Owner only (SaaS)           | Host controla            |
| Conversão automática  | Via módulo (browser-side) | Não documentado             | Não                      |

### 8.3 Referenciamento e Portabilidade

| Aspecto                        | Foundry VTT                  | Owlbear Rodeo      | MapTool                            |
| ------------------------------ | ---------------------------- | ------------------ | ---------------------------------- |
| Formato do path                | Relativo ao Data/            | ID interno (cloud) | MD5 hash ID                        |
| Portabilidade entre instâncias | Média (rebind manual)        | Automática (cloud) | Baixa (hash lookup)                |
| Exportação com assets          | Via módulo externo           | Formato .ob2       | Archive Campaign (feature request) |
| Assets faltantes               | Fallback mínimo (cor sólida) | Não documentado    | Ícone quebrado                     |

---

## 9. Implicações para o Fusion VTT

### 9.1 Decisões Arquiteturais Críticas

Com base na pesquisa, as seguintes decisões de design precisam ser tomadas para o subsistema de arquivos do Fusion:

**Storage backend:**
O Fusion roda localmente com GM como host (como o Foundry). O storage primário deve ser o filesystem local — uma pasta `fusion-data/assets/` análoga ao `Data/assets/` do Foundry. O servidor Node.js/Express serve essa pasta como raiz estática.

**S3 como storage alternativo** deve ser suportado na v1 ou v2, pois resolve o gargalo de bandwidth residencial. A API pública do subsistema de arquivos deve abstrair a fonte (`local` vs. `s3`) para que o código de game systems e módulos não precise saber onde o arquivo está fisicamente.

**Formato de path em Documents:**
Usar paths relativos à raiz do storage (`assets/tokens/goblin.webp`), nunca absolutos. Isso garante portabilidade entre máquinas e facilita backup/restore. Para assets S3, armazenar a URL completa como string.

**Deduplicação:**
Implementar content-addressed storage baseado em SHA-256 (mais moderno que o MD5 do MapTool) para o storage local. Ao fazer upload, calcular hash do arquivo; se já existir um arquivo com mesmo hash, retornar referência sem duplicar. Isso é especialmente valioso para tokens/ícones reutilizados em múltiplos lugares.

**Thumbnails:**
Gerar thumbnails server-side no upload usando `sharp` (Node.js, nativo C++, muito mais rápido que Jimp) para imagens estáticas. Para vídeos, usar `ffmpeg` (se disponível) para extrair frame. Armazenar thumbnails em `assets/.thumbs/<hash>.webp`.

**Compressão automática:**
No upload, oferecer conversão automática para WebP (imagens) e verificar se o browser suporta WebCodecs. Alternativamente, conversão server-side com `sharp` garante compatibilidade universal sem depender do browser do GM.

### 9.2 Estrutura de Diretórios Proposta

```
fusion-data/
  config/             → fusion.config.json (equiv. options.json)
  logs/
  storage/            → raiz do storage de assets
    assets/           → uploads do usuário
      .thumbs/        → thumbnails gerados automaticamente
      .meta/          → metadados e índice de hashes
    systems/          → dados dos sistemas instalados
    worlds/           → dados dos mundos
      <slug>/
        data/         → banco de dados (LevelDB ou SQLite)
        assets/       → assets específicos deste mundo
```

### 9.3 API do Subsistema de Arquivos

O Fusion deve expor uma API de storage análoga ao FilePicker, mas com melhorias:

```typescript
interface StorageAPI {
  // Listar conteúdo de diretório
  browse(source: "local" | "s3", path: string): Promise<BrowseResult>;

  // Upload com hash e deduplicação
  upload(source: "local" | "s3", path: string, file: File): Promise<UploadResult>;

  // Criar diretório
  mkdir(source: string, path: string): Promise<void>;

  // Deletar asset (com verificação de referências)
  delete(source: string, path: string): Promise<DeleteResult>;

  // Buscar por nome/tag (funcionalidade não existente no Foundry nativo)
  search(query: string, options?: SearchOptions): Promise<SearchResult>;

  // Verificar integridade (checar se assets referenciados existem)
  audit(): Promise<AuditResult>;
}
```

### 9.4 Tratamento de Assets Faltantes

O Foundry deixa a desejar aqui — exibe apenas cor sólida sem indicação clara do erro. O Fusion deve:

1. **Placeholder visual:** exibir um tile/token com ícone de "arquivo faltante" claramente identificado no canvas
2. **Relatório de integridade:** ao abrir um mundo, varrer Documents e reportar paths quebrados em um painel de diagnóstico
3. **Path remapping:** oferecer UI para rebind em lote — "todos os assets em `/old/path/` agora estão em `/new/path/`"
4. **Fallback gracioso:** nunca travar o carregamento de cena por causa de um asset faltante; logar o erro e prosseguir

### 9.5 Permissões

Adotar o modelo de roles do Foundry como baseline:

- **STORAGE_BROWSE:** role mínima para ver o FilePicker (default: Trusted Player)
- **STORAGE_UPLOAD:** role mínima para upload (default: Assistant GM)
- **STORAGE_DELETE:** role mínima para deletar (default: GM only)

Adicionar granularidade por pasta: GMs podem marcar pastas como "upload liberado para todos" (útil para pasta de avatares de personagem).

---

## 10. Questões Abertas para a Spec

1. **Content-addressed storage:** usar SHA-256 com CAS puro (arquivo nomeado pelo hash) ou hash como índice com nome amigável preservado? O CAS puro facilita dedup mas complica o FilePicker visual.

2. **Compressão server-side vs. client-side:** conversão WebP via `sharp` no servidor garante compatibilidade mas consome CPU do GM; via WebCodecs API no browser é zero-cost para o servidor mas limita compatibilidade a Chromium/Edge.

3. **Granularidade de thumbnails:** gerar para todo upload automático ou apenas sob demanda? Para sessões com centenas de tokens, geração no upload pode ser custosa.

4. **Import/export com assets:** o Fusion deve ser capaz de exportar um mundo como ZIP self-contained (com todos os assets incluídos)? Qual o limite de tamanho aceitável? O modelo atual do Foundry não inclui assets por padrão.

5. **S3 com presigned URLs:** o Foundry exige buckets públicos, o que é um problema de segurança. O Fusion deveria suportar S3 com presigned URLs (assets privados, acesso temporário)? Isso requer que o servidor do GM assine cada requisição, adicionando latência.

6. **Quota e limites por usuário:** em sessões multi-player onde jogadores podem fazer upload (avatares), deve haver limite de tamanho por usuário? O Foundry não tem esse controle nativo.

7. **Sincronização entre GMs:** em cenários de campanha com múltiplos GMs, como sincronizar o storage local entre máquinas diferentes? (problema fora do escopo do Foundry, mas relevante para Fusion)

8. **Streaming de vídeo:** assets de vídeo grandes (cenas animadas) devem ser servidos via HTTP range requests (streaming progressivo) ou download completo antes de exibir? O Foundry tem histórico de travamentos com WebM grandes.

9. **Formato de metadados:** assets devem ter metadados ricos (tags, descrição, data de criação, hash, dimensões, mime-type) armazenados em banco de dados separado do filesystem? Isso viabiliza busca full-text e auditoria mas adiciona complexidade de sincronização.

---

## Fontes

- [Asset Management | Foundry Virtual Tabletop](https://foundryvtt.com/article/asset-management/)
- [File Picker | Foundry Virtual Tabletop](https://foundryvtt.com/article/file-picker/)
- [Media Optimization Guide | Foundry Virtual Tabletop](https://foundryvtt.com/article/media/)
- [S3 File Storage Integration | Foundry Virtual Tabletop](https://foundryvtt.com/article/aws-s3/)
- [FilePicker API v14 | Foundry Virtual Tabletop](https://foundryvtt.com/api/classes/foundry.applications.apps.FilePicker.html)
- [FilePicker API v13 | Foundry Virtual Tabletop](https://foundryvtt.com/api/v13/classes/foundry.applications.apps.FilePicker.html)
- [TextureLoader API v13 | Foundry Virtual Tabletop](https://foundryvtt.com/api/v13/classes/foundry.canvas.TextureLoader.html)
- [USER_PERMISSIONS Constants v13 | Foundry Virtual Tabletop](https://foundryvtt.com/api/variables/CONST.USER_PERMISSIONS.html)
- [Managing User Data | Foundry Virtual Tabletop](https://foundryvtt.com/article/user-data/)
- [Content Packaging Guide | Foundry Virtual Tabletop](https://foundryvtt.com/article/packaging-guide/)
- [Troubleshooting Scene Loading Issues | Foundry Virtual Tabletop](https://foundryvtt.com/article/ts-scene-loading/)
- [Using Permissions in Foundry | Foundry VTT Community Wiki](https://foundryvtt.wiki/en/development/guides/permissions)
- [Cloudflare R2 as S3 Bucket | Foundry VTT Community Wiki](https://foundryvtt.wiki/en/setup/hosting/cloudflare-r2)
- [Media Optimizer | Foundry VTT Packages](https://foundryvtt.com/packages/media-optimizer)
- [Geano's Scene Optimizer | Foundry VTT Packages](https://foundryvtt.com/packages/geanos-scene-optimizer)
- [Adventure Bundler | Foundry VTT Packages](https://foundryvtt.com/packages/adventure-bundler)
- [fvtt-adventure-bundler | GitHub (dmarcuse)](https://github.com/dmarcuse/fvtt-adventure-bundler)
- [Issue #12897: Create root-level assets folder | foundryvtt/foundryvtt](https://github.com/foundryvtt/foundryvtt/issues/12897)
- [Issue #9723: getTexture cache-busting bug | foundryvtt/foundryvtt](https://github.com/foundryvtt/foundryvtt/issues/9723)
- [Issue #9765: Video texture hang | foundryvtt/foundryvtt](https://github.com/foundryvtt/foundryvtt/issues/9765)
- [Issue #626: Archive Campaign | RPTools/maptool](https://github.com/RPTools/maptool/issues/626)
- [MapTool Image Assets — RPTools Forums](https://forums.rptools.net/viewtopic.php?t=17509)
- [The Forge — Features](https://forge-vtt.com/features)
- [Assets API | Owlbear Rodeo Documentation](https://docs.owlbear.rodeo/extensions/apis/assets/)
- [Images | Owlbear Rodeo Documentation](https://docs.owlbear.rodeo/docs/images/)
- [Aggressive asset caching issue — The Forge Forums](https://forums.forge-vtt.com/t/aggressive-asset-caching-issue/14132)
- [Improve cache controls | Issue #9642 | foundryvtt/foundryvtt](https://github.com/foundryvtt/foundryvtt/issues/9642)
- [Set Up a CDN for Foundry VTT Using Backblaze and Cloudflare — TCJ Lighting](https://tcj.lighting/vtt-cdn-2022/)
