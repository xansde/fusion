# 22 — Instalação e Distribuição

**Status:** draft v0.1
**Data:** 2026-06-11

**Baseada em:**

- `docs/research/92-install-distribution-autoupdate.md` — distribuição, Tauri v2, auto-update, empacotamento Node.js, onboarding
- `docs/research/01-foundry-arquitetura-stack.md` — referência Foundry: requisitos mínimos, porta, UPnP, estrutura de dados

---

## Objetivo

Definir como o Fusion VTT é empacotado, distribuído, instalado e atualizado na máquina do GM. O GM é o único usuário que instala software; os jogadores conectam pelo navegador sem qualquer instalação.

O objetivo primário do MVP é que um GM não-técnico consiga: baixar um único arquivo, executar, responder um wizard de primeira vez e ter o servidor ativo em menos de 5 minutos.

---

## Escopo

### O que inclui

- Formato e pipeline de build dos artefatos de distribuição por SO (Windows, macOS, Linux)
- Empacotamento do runtime Node.js (sidecar) junto com o app
- Wizard de primeira execução (data directory, porta, senha de admin)
- Atalho de desktop para Windows (conforme convenção de projeto)
- Mecanismo de auto-update com canais stable/dev
- Backup dos worlds antes de aplicar um update
- Estratégias de conectividade de rede (LAN, UPnP, túneis, port forwarding)
- Requisitos mínimos de hardware (GM e jogadores)
- Estrutura de diretórios dos dados do usuário
- Code signing e notarização por plataforma
- Pipeline CI/CD de release (GitHub Actions)
- Wrapper Tauri v2 de desktop [V2]

### O que NÃO inclui

- Hosting gerenciado por terceiros (fora do escopo do projeto; mencionado apenas como referência)
- Módulos e sistemas instalados pós-setup (ver `16-compendiums-e-importacao.md`)
- Segurança detalhada de rede e TLS (ver `21-seguranca.md`)
- Backup e restore de worlds como operação contínua (ver `24-operacao-backups-telemetria.md`)
- Descoberta LAN via mDNS/Bonjour [V2]

---

## Conceitos e Terminologia

| Termo                 | Definição                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **sidecar**           | Binário do servidor Node.js empacotado dentro do app Tauri; gerenciado pelo processo Rust do Tauri               |
| **data directory**    | Pasta escolhida pelo GM na primeira execução; contém `worlds/`, `systems/`, `assets/`, `Config/`, `Logs/`        |
| **portable build**    | Modo em que o data directory fica ao lado do executável, em vez da pasta de documentos do usuário                |
| **update channel**    | Canal de distribuição: `stable` (produção) ou `dev` (preview de features)                                        |
| **update manifest**   | Arquivo JSON (`latest.json`) hospedado junto ao release; descreve versões disponíveis por plataforma             |
| **latest.json**       | Manifesto de versão lido pelo `tauri-plugin-updater` para detectar updates disponíveis                           |
| **NSIS installer**    | Formato de instalador Windows gerado pelo Tauri; suporta instalação por usuário sem privilégios de administrador |
| **AppImage**          | Formato de distribuição Linux portátil; não requer instalação; executa diretamente                               |
| **notarização**       | Processo obrigatório da Apple para apps distribuídos fora da Mac App Store; valida que o app não contém malware  |
| **UPnP**              | Universal Plug and Play; protocolo que solicita automaticamente ao roteador a abertura de portas                 |
| **Cloudflare Tunnel** | `cloudflared` — cria túnel HTTPS gratuito entre o servidor local e a internet sem necessidade de port forwarding |
| **join token**        | Token aleatório anexado à URL de convite para impedir que estranhos entrem na sessão                             |
| **world.db**          | Arquivo SQLite por mundo (ver `03-persistencia-e-mundos.md`)                                                     |

---

## Decisões

### DEC-DST-01: Wrapper de desktop é Tauri v2 (implementação [V2]; MVP headless)

**Decisão:** No MVP, o Fusion distribui apenas o servidor Node.js em modo headless (CLI/executável sem GUI nativa). A UI de gerenciamento do GM é servida pelo próprio servidor e acessada no browser local. O wrapper Tauri v2 com tray icon é implementado na fase V2.

**Alternativas rejeitadas:**

- Electron imediato: bundle ~180 MB, RAM idle ~450 MB, cold start ~12 s — overhead desnecessário para o MVP.
- Sem wrapper nunca: dados de adoção do Foundry mostram 72% dos usuários em app de desktop; o wrapper Tauri v2 é obrigatório para adoção em larga escala.

**Racional:** Focar o MVP na funcionalidade de jogo. O Tauri v2 (~12 MB, ~85 MB RAM idle, cold start ~1,8 s) é a escolha para V2 quando o wrapper agregar valor real (tray icon, iniciar/parar, notificações).

---

### DEC-DST-02: Empacotamento Node.js via `@yao-pkg/pkg`

**Decisão:** O servidor (`packages/server`) é compilado em um executável autocontido por plataforma usando `@yao-pkg/pkg` (fork ativo do `vercel/pkg`), suportando `node22-win-x64`, `node22-macos-x64`, `node22-macos-arm64`, `node22-linux-x64`.

**Alternativas rejeitadas:**

- Node.js SEA: não tem VFS; `fs.readFile` de `node_modules` dentro do SEA é problemático; sem suporte cross-compilation transparente.
- Distribuir como pacote npm (`npx fusion-server`): exige que o GM tenha Node.js instalado; UX ruim para usuários não-técnicos.
- Node.js como `externalBin` no Tauri: adiciona ~50 MB ao bundle sem vantagem funcional.

**Racional:** `@yao-pkg/pkg` produz um binário autocontido por plataforma que o usuário executa sem dependências externas. O npm é mantido ativamente e suporta Node 22.

---

### DEC-DST-03: SQLite gerenciado pelo processo principal (sem addon nativo no sidecar)

**Decisão:** O `better-sqlite3` (addon nativo `.node`) **não é usado no sidecar** empacotado com `pkg`. No contexto headless do MVP, a persistência SQLite fica no processo Node.js principal, compilado como parte do executável. A estratégia detalhada de acesso ao banco é definida em `03-persistencia-e-mundos.md`.

**Problema evitado:** `pkg` não pode embutir addons `.node` no binário; exigiria distribuir o arquivo `.node` como artefato externo separado por plataforma e arquitetura — UX inaceitável.

**Racional:** Eliminar completamente addons nativos do código empacotado com `pkg`. Se o wrapper Tauri v2 for adotado no V2, migrar para `tauri-plugin-sql` (SQLite gerenciado pelo Rust) como solução definitiva.

---

### DEC-DST-04: Instalador Windows NSIS; macOS DMG; Linux AppImage + DEB

**Decisão:**

- **Windows:** NSIS (`-setup.exe`) — suporta instalação por usuário sem UAC, cross-compilation em CI, ARM64 via emulação.
- **macOS:** DMG com App Bundle (`.app`) — padrão UX da plataforma; notarização obrigatória.
- **Linux:** AppImage (portátil, sem instalação) + DEB (Debian/Ubuntu). RPM pode ser adicionado após MVP.
- **MVP headless:** um único executável binário por plataforma, sem instalador com wizard de sistema; a instalação é apenas "copiar e executar".

**Alternativas rejeitadas:**

- MSI (Windows): só compila em Windows; não suporta ARM64 nativo; mais rígido que NSIS.
- Flatpak/Snap Linux: overhead de sandbox conflita com acesso ao sistema de arquivos local (data directory do GM).

---

### DEC-DST-05: Code signing Windows com Azure Artifact Signing; macOS com Apple Developer

**Decisão:**

- **Windows:** Microsoft Azure Artifact Signing (Trusted Signing) — $9,99/mês, funciona em CI Linux/macOS, sem hardware token.
- **macOS:** Apple Developer Program — $99/ano, notarização via `xcrun notarytool` integrada no `tauri-action`.
- **Linux:** sem code signing obrigatório para distribuição direta (não App Store).
- **Fase MVP headless:** sem code signing (distribuição para early adopters). Code signing entra junto com a distribuição pública estável.

**Alternativas rejeitadas:**

- Certificado OV tradicional (~$200–300/ano): desde 2023, exige HSM ou serviço cloud de qualquer forma; sem vantagem vs Azure.
- EV: desde março de 2024, não elimina mais o warning do SmartScreen — sem vantagem prática.
- SignPath Foundation (gratuito open-source): avaliar se o Fusion for licenciado open-source.

---

### DEC-DST-06: Auto-update via `tauri-plugin-updater` com GitHub Releases

**Decisão:** O mecanismo de auto-update do wrapper Tauri v2 usa `tauri-plugin-updater` com manifesto `latest.json` hospedado no GitHub Releases. Assinatura criptográfica obrigatória (par de chaves gerado com `tauri signer generate`). Suporte a canais `stable` e `dev` via endpoints distintos.

**Decisão para MVP headless:** auto-update é um script de atualização CLI simples que verifica a versão via GitHub Releases API, baixa o novo binário e substitui o atual com backup prévio dos worlds.

**Racional:** GitHub Releases é gratuito, simples e suficiente para o MVP. `tauri-plugin-updater` é a solução nativa e obrigatória para o wrapper V2. CrabNebula Cloud é avaliado se escala ou analytics forem necessários.

---

### DEC-DST-07: Porta padrão 33000; UPnP opcional; Cloudflare Tunnel como fallback WAN

**Decisão:**

- Porta padrão: **33000** (porta própria do Fusion — ver `01-arquitetura-geral.md` D7 e REQ-ARQ-022).
- UPnP: **desabilitado por padrão** no MVP; habilitável via configuração (risco de segurança em redes corporativas).
- Cloudflare Tunnel (`cloudflared`) integrado como opção "Compartilhar pela internet" — zero config para o GM.
- URL de convite LAN detectada automaticamente + exibida com QR code.

**Alternativas rejeitadas:**

- _30000_: é a porta default do Foundry VTT. Reusá-la causaria conflito de porta para quem roda os dois apps na mesma máquina e confundiria diagnósticos de rede (ver `01-arquitetura-geral.md` D7).
- UPnP habilitado por padrão: o Foundry usa essa abordagem, mas o risco de segurança em redes corporativas/educacionais supera a conveniência.
- ngrok: requer conta; menos privacidade do que Cloudflare Tunnel.
- Relay TURN próprio: requer infraestrutura; fora do escopo.

---

## Requisitos Funcionais

### Empacotamento e Build

**REQ-DST-001** [MVP] O pipeline de build deve produzir, para cada release, executáveis autocontidos (sem dependência de runtime externo) para: Windows x64, macOS x64 (Intel), macOS ARM64 (Apple Silicon) e Linux x64.

**REQ-DST-002** [MVP] O executável do servidor deve incluir todos os arquivos estáticos do cliente (`packages/client/dist/`) embutidos ou servidos a partir de um caminho relativo ao executável.

**REQ-DST-003** [MVP] O build deve ser reproduzível via um único comando na raiz do monorepo (`pnpm build:release`) e executar end-to-end em CI (GitHub Actions) sem intervenção manual além da tag de versão.

**REQ-DST-004** [MVP] O artefato final deve ser nomeado no padrão `fusion-server-{version}-{platform}-{arch}[.exe]` (ex.: `fusion-server-0.1.0-windows-x64.exe`).

**REQ-DST-005** [V2] O wrapper Tauri v2 deve empacotar o `fusion-server` como sidecar (`externalBin`) e iniciá-lo automaticamente ao abrir o app, gerenciando seu ciclo de vida (start/stop/restart).

**REQ-DST-006** [V2] O Tauri wrapper deve gerar instaladores NSIS para Windows, DMG para macOS e AppImage + DEB para Linux, via `tauri-action` no CI.

### Estrutura do Data Directory

**REQ-DST-007** [MVP] Na primeira execução, o servidor deve criar a seguinte estrutura no data directory escolhido pelo GM:

```
{dataDir}/
├── Config/
│   └── fusion.json        ← configuração do servidor (porta, Admin Key hash, jwtHmacSecret, canal de update, log level)
├── worlds/                ← um subdiretório por mundo criado
│   └── <slug>/
│       ├── world.db       ← banco SQLite do mundo
│       ├── assets/        ← assets específicos do mundo
│       └── backups/       ← backups automáticos e manuais do mundo (ver 24-operacao-backups-telemetria.md)
├── systems/               ← sistemas instalados (links simbólicos ou cópias no MVP)
├── assets/                ← uploads de assets globais (imagens, áudio, etc.)
├── backups/               ← backups de pre-event (updates, migrações) e exports globais
└── Logs/
    ├── fusion-{date}.log  ← log estruturado rotacionado diariamente
    ├── error.log          ← acumulado de entradas error/fatal
    ├── audit.log          ← log de auditoria de ações sensíveis
    └── diagnostics.json   ← diagnóstico exportável para suporte
```

**REQ-DST-008** [MVP] O data directory padrão deve ser:

- Windows: `%USERPROFILE%\Documents\FusionVTT`
- macOS: `~/Documents/FusionVTT`
- Linux: `~/FusionVTT`

> **Nota de nomenclatura para specs irmãs.** A spec `24-operacao-backups-telemetria.md` se refere ao data directory com o alias `fusion-data/` em seus caminhos de exemplo (ex.: `fusion-data/worlds/`, `fusion-data/Logs/`, `fusion-data/Config/fusion.json`). Todos esses caminhos apontam para `{dataDir}/` conforme definido aqui — `fusion-data` é apenas um alias descritivo, não um subdiretório adicional. A raiz efetiva é o caminho configurado via wizard ou `--data-dir`. O nome do arquivo de configuração já está harmonizado para `Config/fusion.json` em todas as specs.

**REQ-DST-009** [MVP] Deve ser possível especificar um data directory alternativo via flag CLI (`--data-dir <path>`), permitindo instalações portáteis (data directory ao lado do executável).

**REQ-DST-010** [MVP] O servidor deve verificar permissões de leitura/escrita no data directory na inicialização e abortar com mensagem clara se o acesso for negado.

### Wizard de Primeira Execução

**REQ-DST-011** [MVP] Na primeira execução (detectada pela ausência de `Config/fusion.json`), o servidor deve servir uma página de setup inicial no browser (`http://localhost:{porta}/setup`) antes de disponibilizar qualquer funcionalidade de jogo.

**REQ-DST-012** [MVP] O wizard de primeira execução deve coletar, nesta ordem:

1. **Data directory** — caminho (pré-preenchido com o default; input livre; botão "Usar pasta portátil")
2. **Porta do servidor** — número entre 1024 e 65535 (default: 33000); verificar se está disponível em tempo real
3. **Senha de admin (Admin Key)** — campo de senha com confirmação; armazenada como hash **Argon2id** (`@node-rs/argon2`; parâmetros mínimos: `memory≥65536 KiB`, `iterations≥3`, `parallelism≥4`) em `Config/fusion.json`; conforme `21-seguranca.md` REQ-SEC-010
4. **Conectividade** — detectar IP LAN, exibir URL de convite; testar se a porta é acessível localmente

**REQ-DST-013** [MVP] Após conclusão do wizard, o servidor deve reiniciar automaticamente (ou redirecionar) para a tela principal de gerenciamento.

**REQ-DST-014** [MVP] O wizard deve ser re-executável a qualquer momento via `Setup → Reconfigurar` na tela de admin, sem necessidade de reinstalar o app ou excluir dados.

**REQ-DST-015** [MVP] Se o servidor detectar que a porta configurada está em uso na inicialização, deve exibir mensagem de erro clara com sugestão de porta alternativa disponível, em vez de falhar silenciosamente.

### Dois Planos de Autenticação

**REQ-DST-015A** [MVP] O Fusion opera com **dois planos de autenticação independentes**, análogos ao modelo do Foundry (research `06-foundry-rede-multiplayer.md` §autenticação):

1. **Plano de instalação — Admin Key:** protege exclusivamente a rota `/setup` e as operações de nível de instalação (configurar porta, criar/deletar mundos, aplicar updates). É a senha configurada no wizard de primeira execução, armazenada como hash Argon2id em `Config/fusion.json` (`adminPasswordHash`). A tela de setup emite um **Bearer token de sessão admin** (JWT HMAC-SHA256 de curta duração, usando `jwtHmacSecret`) após verificação da Admin Key — esse token é o que os endpoints de admin (`/admin/*`) exigem como `Bearer`. **Não é** o mesmo que o JWT de usuário de mundo.

2. **Plano de mundo — JWT de usuário GAMEMASTER:** protege os endpoints de jogo (`/api/users`, `/api/admin/status`, e demais endpoints que exigem `Bearer (GM)` nas specs 05 e 24). Emitido pelo fluxo normal de login de um `User` com `role = GAMEMASTER` em um mundo específico (ver `05-usuarios-e-permissoes.md` DEC-USR-03 e REQ-USR-019).

Os dois planos são paralelos: um GM pode ter a Admin Key sem ter um User de mundo, e vice-versa. A tela de admin de instalação (`/setup`) usa apenas o plano 1; as fichas, o chat e os endpoints de jogo usam apenas o plano 2. Ver `05-usuarios-e-permissoes.md` DEC-USR-06 para a relação entre Admin Key e usuários de mundo.

### Atalho e Inicialização (Windows)

**REQ-DST-016** [MVP] No Windows, o instalador (ou a primeira execução) deve oferecer a criação de:

- Atalho no Desktop com ícone do Fusion
- Entrada no menu Iniciar
- (Opcional) Iniciar com o Windows via entrada no registro

**REQ-DST-017** [MVP] O atalho de Desktop no Windows deve lançar o servidor e abrir o browser automaticamente na URL `http://localhost:{porta}`.

**REQ-DST-018** [V2] O wrapper Tauri v2 deve exibir um tray icon no Windows/macOS/Linux com menu de contexto contendo: "Abrir Fusion", "Iniciar Servidor", "Parar Servidor", "Sobre", "Sair".

### Auto-Update (MVP headless)

**REQ-DST-019** [MVP] O servidor deve verificar a disponibilidade de updates ao iniciar, consultando a GitHub Releases API (`https://api.github.com/repos/{owner}/fusion/releases/latest`) para o canal configurado (`stable` ou `dev`).

**REQ-DST-020** [MVP] A verificação de update deve ser não-bloqueante: o servidor inicia normalmente mesmo se a verificação falhar (sem conexão, rate limit da API, etc.).

**REQ-DST-021** [MVP] Quando um update estiver disponível, o servidor deve:

1. Notificar o GM na tela de admin com versão atual, versão nova e notas de release
2. Não iniciar o download automaticamente sem consentimento explícito do GM

**REQ-DST-022** [MVP] Antes de aplicar um update, o sistema deve:

1. Gerar o pre-event backup de cada world ativo via SQLite Online Backup API (`db.backup()`) conforme `24-operacao-backups-telemetria.md` REQ-OPS-005, salvo como `worlds/<slug>/backups/pre-event-update-<version>-<timestamp-ISO>.db` (formato canônico de backup `.db`, não tarball)
2. Confirmar com o GM que os snapshots foram criados antes de prosseguir

**REQ-DST-023** [MVP] O processo de update deve:

1. Baixar o novo binário para um arquivo temporário
2. Verificar o hash SHA-256 do download contra o valor publicado no release
3. Substituir o executável atual pelo novo (renomear o atual para `.bak` antes)
4. Reiniciar o servidor

**REQ-DST-024** [MVP] Em caso de falha durante o update, o sistema deve restaurar o binário anterior (`.bak`) e continuar funcionando na versão atual.

**REQ-DST-025** [MVP] O canal de update deve ser configurável em `Config/fusion.json` (`updateChannel: "stable" | "dev"`), com `stable` como padrão.

**REQ-DST-026** [V2] O wrapper Tauri v2 deve usar `tauri-plugin-updater` com assinatura criptográfica (par Ed25519 gerado com `tauri signer generate`) para verificar integridade antes de instalar qualquer update.

**REQ-DST-027** [V2] O manifesto `latest.json` deve ser gerado automaticamente pelo pipeline CI e hospedado como artefato do GitHub Release, em dois arquivos separados: `latest-stable.json` e `latest-dev.json`.

### Conectividade e Rede

**REQ-DST-028** [MVP] O servidor deve detectar automaticamente o(s) endereço(s) IP LAN da máquina e exibir a URL de convite LAN na tela de admin (ex.: `http://192.168.1.42:33000`).

**REQ-DST-029** [MVP] A tela de admin deve exibir um QR code gerado a partir da URL de convite LAN para facilitar a conexão de jogadores via celular.

**REQ-DST-030** [V2] A URL de convite deve suportar um join token de uso único (`/join?world=<worldId>&token=<uuid>`), gerado pelo GM, com validade configurável (padrão: 24h), permitindo que um novo usuário seja criado automaticamente ao acessar o link pela primeira vez. Alinhado com `05-usuarios-e-permissoes.md` REQ-USR-039 [V2]. No MVP, a URL de convite segue o formato `/join?world=<worldId>` sem token (ver REQ-USR-036).

**REQ-DST-031** [MVP] A documentação de setup deve incluir guia passo a passo de port forwarding para os roteadores mais comuns (Mikrotik, TP-Link, ASUS, Intelbras) na interface de ajuda do admin.

**REQ-DST-032** [MVP] O servidor deve incluir suporte a configuração de reverse proxy via variáveis de configuração: `proxySSL: boolean`, `proxyPort: number`, `routePrefix: string` (permite hospedar em `exemplo.com/fusion`).

**REQ-DST-033** [V2] O servidor deve suportar abertura automática de porta via UPnP (`node-upnp-ts` ou equivalente), habilitável via toggle na tela de admin, com feedback visual do status (porta aberta / falha / não suportado).

**REQ-DST-034** [V2] A tela de admin deve oferecer botão "Compartilhar pela internet" que inicia um túnel Cloudflare (`cloudflared`) automaticamente e exibe a URL HTTPS pública ao GM.

**REQ-DST-035** [V2] O servidor deve anunciar sua presença via mDNS/Bonjour (`_fusion._tcp.local`) para descoberta automática de jogadores na mesma rede local.

### Versão e Compatibilidade de Protocolo

**REQ-DST-036** [MVP] O servidor deve incluir sua versão semântica (ex.: `0.1.0`) no handshake inicial WebSocket, no campo `serverVersion` da mensagem `hello`. Ver `04-rede-e-sincronizacao.md`.

**REQ-DST-037** [MVP] O servidor deve declarar a versão do protocolo de comunicação (ex.: `protocolVersion: 1`) no handshake. Se um cliente com versão de protocolo incompatível conectar, o servidor deve enviar mensagem `protocol_mismatch` com link de atualização e fechar a conexão graciosamente.

**REQ-DST-038** [MVP] O arquivo `Config/fusion.json` deve incluir os campos `serverVersion` e `dataVersion` para detecção de migrações necessárias ao atualizar.

### Requisitos de Sistema

**REQ-DST-039** [MVP] Requisitos mínimos da **máquina do GM** (servidor):

| Recurso             | Mínimo                                              | Recomendado                        |
| ------------------- | --------------------------------------------------- | ---------------------------------- |
| CPU                 | Dual-core 2 GHz                                     | Quad-core 3 GHz                    |
| RAM                 | 4 GB                                                | 8 GB                               |
| Armazenamento livre | 2 GB                                                | 10 GB+ (assets de mapas)           |
| Upload de rede      | 5 Mbps                                              | 20 Mbps                            |
| OS                  | Windows 10 (64-bit), macOS 11 Big Sur, Ubuntu 20.04 | Windows 11, macOS 14, Ubuntu 22.04 |

**REQ-DST-040** [MVP] Requisitos mínimos do **browser dos jogadores** (cliente):

| Recurso   | Mínimo                                             |
| --------- | -------------------------------------------------- |
| Browser   | Chrome 110+, Firefox 115+, Edge 110+, Safari 16.4+ |
| RAM       | 4 GB (8 GB recomendado)                            |
| GPU       | Aceleração de hardware ativa; suporte a WebGL 2.0  |
| Resolução | 1280×720                                           |
| Conexão   | 2 Mbps download                                    |

**REQ-DST-041** [MVP] O cliente deve verificar suporte gráfico no lado do browser antes de inicializar o canvas: tentativa de contexto WebGPU; em caso de falha, fallback para WebGL 2.0; se nenhum estiver disponível, exibir página de erro estática com instruções para habilitar aceleração de hardware. O servidor não tem como detectar capacidades gráficas pelo User-Agent — a detecção é exclusivamente client-side, alinhada com a stack PIXI.js v8 (WebGPU com fallback WebGL) fixada no projeto. O requisito mínimo do lado do cliente (WebGL 2.0) é definido em REQ-DST-040.

### Pipeline CI/CD

**REQ-DST-042** [MVP] O pipeline CI deve rodar em GitHub Actions com matrix de plataformas: `windows-latest` (x64), `macos-latest` (x64 + ARM64 via cross-compilation ou runners separados), `ubuntu-22.04` (x64).

**REQ-DST-043** [MVP] O trigger de release deve ser uma tag Git no formato `v{semver}` (ex.: `v0.1.0`). O pipeline deve gerar automaticamente os artefatos e criar um GitHub Release com changelog extraído dos commits desde a última tag.

**REQ-DST-044** [MVP] O pipeline deve executar o suite de testes (`pnpm test`) antes de gerar os artefatos de release; falha nos testes cancela o release.

**REQ-DST-045** [V2] O pipeline do wrapper Tauri v2 deve usar `tauri-apps/tauri-action` com os seguintes secrets configurados: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET` (Windows signing), `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_PASSWORD` (macOS signing e notarização).

---

## Requisitos Não-Funcionais

**REQ-DST-046** [MVP] O tamanho do executável headless (sidecar + assets cliente embutidos) não deve exceder 150 MB por plataforma.

**REQ-DST-047** [MVP] O tempo de inicialização do servidor (primeira resposta HTTP na porta configurada) deve ser inferior a 5 segundos em hardware recomendado.

**REQ-DST-048** [MVP] O wizard de primeira execução deve ser completável em menos de 3 minutos por um GM não-técnico.

**REQ-DST-049** [MVP] O processo de update (download + verificação + substituição + restart) não deve exceder 2 minutos em conexão de 10 Mbps.

**REQ-DST-050** [MVP] Logs de erro de instalação/inicialização devem ser gravados em `Logs/fusion-{date}.log` com nível de detalhe suficiente para diagnóstico remoto (stack trace, versão do OS, porta tentada).

**REQ-DST-051** [V2] O instalador Tauri NSIS (Windows) não deve exigir privilégios de administrador (instalação por usuário, sem UAC prompt).

---

## Modelo de Dados

### `Config/fusion.json` — Configuração do servidor

> **Nome canônico único.** O arquivo de configuração do servidor é **`Config/fusion.json`** — único nome válido em todo o cluster de specs. As specs `05-usuarios-e-permissoes.md`, `21-seguranca.md` e `24-operacao-backups-telemetria.md` já referenciam este mesmo arquivo por `fusion.json` (nomes antigos `options.json`/`server.json` foram harmonizados; menções a `options.json` que restam descrevem apenas o arquivo equivalente do Foundry na pesquisa). Todos os campos que as specs irmãs esperam encontrar neste arquivo estão listados no modelo abaixo (rede, segurança, log, atualização).

```typescript
interface FusionConfig {
  // Versões
  serverVersion: string; // ex.: "0.1.0" — versão do binário que escreveu este arquivo
  dataVersion: number; // versão do schema do data directory; incrementada em migrações

  // Rede
  port: number; // padrão: 33000 (ver 01-arquitetura-geral.md D7 e REQ-ARQ-022)
  hostname: string; // padrão: "0.0.0.0" (ouve em todas as interfaces)
  routePrefix: string; // padrão: "" (raiz); ex.: "/fusion" para reverse proxy
  proxySSL: boolean; // true se atrás de reverse proxy com SSL
  proxyPort: number | null; // porta externa do proxy (null = usar `port`)
  upnpEnabled: boolean; // padrão: false
  allowedOrigins: string[]; // origens permitidas no upgrade WS e no CORS REST; padrão: [] (apenas 'self'); ver 21-seguranca.md REQ-SEC-056/057
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace"; // nível de log Pino; padrão: "info"; alterável em runtime sem reiniciar (ver 24-operacao-backups-telemetria.md REQ-OPS-023)

  // Autenticação
  adminPasswordHash: string; // Argon2id hash da Admin Key (ver REQ-DST-012 e 21-seguranca.md REQ-SEC-010)
  jwtHmacSecret: string; // segredo HMAC-SHA256 para assinar Access Tokens JWT (gerado na primeira execução; ver 05-usuarios-e-permissoes.md DEC-USR-03 e REQ-USR-NF-004); mantido apenas em memória em runtime — não exposto via HTTP

  // Updates
  updateChannel: "stable" | "dev"; // padrão: "stable"
  lastUpdateCheck: string | null; // ISO 8601 da última verificação

  // Onboarding
  setupCompleted: boolean; // false enquanto wizard não foi concluído
  dataDirectory: string; // path absoluto do data directory escolhido

  // Telemetria (opcional, ver 24-operacao-backups-telemetria.md)
  telemetryEnabled: boolean; // padrão: false; opt-in explícito
}
```

### `update-manifest.json` — Manifesto de release (gerado pelo CI)

```typescript
// Hospedado em: https://github.com/{owner}/fusion/releases/download/{tag}/latest-{channel}.json
interface UpdateManifest {
  version: string; // semver sem prefixo "v": "0.2.0"
  releaseDate: string; // ISO 8601
  releaseNotes: string; // markdown com changelog resumido
  channel: "stable" | "dev";
  platforms: {
    [platform: string]: {
      // ex.: "windows-x64", "macos-x64", "macos-arm64", "linux-x64"
      url: string; // URL de download do binário
      sha256: string; // hash SHA-256 do binário
      size: number; // tamanho em bytes
      signature?: string; // assinatura Ed25519 (apenas no wrapper Tauri V2)
    };
  };
}
```

---

## API e Eventos

### Endpoints HTTP do servidor relevantes para distribuição

| Método | Path                    | Descrição                                                                             |
| ------ | ----------------------- | ------------------------------------------------------------------------------------- |
| `GET`  | `/`                     | Redireciona para `/setup` na primeira execução; para `/game` após                     |
| `GET`  | `/setup`                | Wizard de primeira execução (SPA Svelte)                                              |
| `GET`  | `/join?world=<worldId>` | Página de entrada para jogadores (MVP); `?token=<uuid>` adicional apenas em [V2]      |
| `GET`  | `/admin/version`        | Retorna `{ serverVersion, dataVersion, updateChannel }`                               |
| `GET`  | `/admin/update/check`   | Dispara verificação de update; retorna `{ available, latestVersion, releaseNotes }`   |
| `POST` | `/admin/update/apply`   | Inicia processo de update (requer auth admin)                                         |
| `GET`  | `/admin/network`        | Retorna `{ lanUrl, publicIp, upnpStatus, tunnelUrl? }`                                |
| `GET`  | `/health`               | `{ status: "ok", version, uptime }` — para monitoramento e tela de join dos jogadores |

### Eventos WebSocket relacionados

Ver `04-rede-e-sincronizacao.md` para o protocolo completo. Eventos específicos de distribuição:

| Evento (servidor → cliente) | Payload                                               | Quando                                                                  |
| --------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `server.update_available`   | `{ version, channel, releaseNotes }`                  | Quando update detectado; enviado apenas para clientes com role GM/admin |
| `server.restarting`         | `{ reason: "update" \| "config", countdown: number }` | Antes de reiniciar; clientes exibem countdown                           |
| `server.protocol_mismatch`  | `{ serverProtocol, clientProtocol, updateUrl }`       | Ao detectar versão de protocolo incompatível                            |

---

## Dependências (specs irmãs)

| Spec                                | Dependência                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `03-persistencia-e-mundos.md`       | Estrutura do `world.db`; estratégia de backup antes do update; localização do data directory       |
| `04-rede-e-sincronizacao.md`        | Protocolo WebSocket; handshake com `serverVersion` e `protocolVersion`; evento `server.restarting` |
| `05-usuarios-e-permissoes.md`       | Autenticação do GM na tela de admin; sessões; hash da senha de admin                               |
| `21-seguranca.md`                   | TLS/SSL no servidor; configuração de reverse proxy seguro; CORS                                    |
| `24-operacao-backups-telemetria.md` | Backup contínuo de worlds; logs de operação; telemetria opt-in                                     |
| `25-testes-e-qualidade.md`          | Testes de instalação em CI; smoke test pós-deploy                                                  |

---

## Critérios de Aceitação

**CA-DST-01:** GM executa o binário em Windows 10 fresh install, acessa `http://localhost:33000/setup` no browser em menos de 10 segundos, conclui o wizard e tem o servidor ativo.

**CA-DST-02:** O mesmo binário Windows funciona em Windows 11, sem instalação de dependências adicionais (Node.js, VC++ redistributable, etc.).

**CA-DST-03:** Em macOS ARM64 (Apple Silicon), o binário executa nativamente sem Rosetta 2.

**CA-DST-04:** Em Ubuntu 22.04, o binário AppImage executa com `chmod +x ./fusion-server-*.AppImage && ./fusion-server-*.AppImage` sem dependências adicionais.

**CA-DST-05:** O wizard detecta corretamente o IP LAN e exibe URL de convite válida. Um jogador na mesma rede consegue abrir a URL e ver a tela de join.

**CA-DST-06:** O processo de update baixa o novo binário, verifica o hash SHA-256, cria backup dos worlds, substitui o executável e reinicia sem intervenção manual.

**CA-DST-07:** Se o download do update for corrompido (hash diverge), o servidor mantém o binário atual e exibe mensagem de erro ao GM.

**CA-DST-08:** [V2] A URL de convite com join token (`/join?world=<id>&token=<uuid>`) bloqueia acesso de clientes sem o token correto (ver REQ-DST-030 [V2] e `05-usuarios-e-permissoes.md` REQ-USR-039).

**CA-DST-09:** O campo `serverVersion` aparece corretamente na mensagem de handshake WebSocket após uma atualização.

**CA-DST-10:** A tela de admin exibe "Update disponível" com versão e notas quando existe release mais recente no GitHub, e não exibe quando a versão atual já é a mais recente.

---

## Questões em Aberto

1. **O projeto Fusion será open-source?** Se sim, SignPath Foundation oferece code signing Windows gratuito para projetos open-source qualificados, eliminando o custo do Azure Artifact Signing. Decisão afeta também a escolha de licença (`26-licencas-e-legal.md`).

2. **Suporte a Windows ARM64 nativo?** O `@yao-pkg/pkg` suporta `node22-win-arm64`? Dado o crescimento de dispositivos ARM64 Windows (Surface Pro X, Snapdragon X), vale avaliar se o CI compila para esse target no MVP ou apenas em V2.

3. **Cloudflare Tunnel requer conta Cloudflare?** A versão gratuita do `cloudflared` (túnel quick tunnel) não requer conta mas gera URL aleatória a cada sessão. Para URL persistente, requer conta free. Qual UX queremos oferecer? (URL temporária a cada sessão vs. URL fixa com login)

4. **Migração de `fusion.json` entre versões:** precisamos de um sistema formal de migration scripts para o data directory (similar ao que o Foundry faz com `options.json`)? Ou `dataVersion` com migrations inline no código é suficiente para o MVP?

5. **Suporte a múltiplas instâncias do servidor na mesma máquina?** (cenário: GM quer servir dois worlds simultaneamente em portas diferentes). Isso é necessário no MVP ou V2?

6. **Integração com gerenciadores de pacotes:** vale publicar um pacote no WinGet (Windows Package Manager), Homebrew (macOS) e/ou como pacote DEB/RPM em repositório apt/yum? Melhora significativamente a UX de atualização em Linux. Escopo V2.

---

## Referências

- `docs/research/92-install-distribution-autoupdate.md` — distribuição, Tauri v2, empacotamento Node.js, auto-update, onboarding (documento principal desta spec)
- `docs/research/01-foundry-arquitetura-stack.md` — arquitetura e requisitos de sistema do Foundry como referência de benchmark
- [Tauri v2 — Distribute Overview](https://v2.tauri.app/distribute/)
- [Tauri v2 — Updater Plugin](https://v2.tauri.app/plugin/updater/)
- [Tauri v2 — Node.js as Sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)
- [Tauri v2 — GitHub Actions Pipeline](https://v2.tauri.app/distribute/pipelines/github/)
- [@yao-pkg/pkg — npm](https://www.npmjs.com/package/@yao-pkg/pkg)
- [Microsoft Azure Artifact Signing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
- [Foundry VTT — Year in Review 2025 (dados de adoção)](https://foundryvtt.com/article/year-in-review-2025/)
