/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-client-from-server",
      comment: "packages/server must not import packages/client (REQ-ARQ-004)",
      severity: "error",
      from: { path: "^packages/server" },
      to: { path: "^packages/client" },
    },
    {
      name: "no-server-from-client",
      comment: "packages/client must not import packages/server (REQ-ARQ-003)",
      severity: "error",
      from: { path: "^packages/client" },
      to: { path: "^packages/server" },
    },
    {
      name: "no-server-from-systems",
      comment: "systems/* must not import packages/server (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^systems/" },
      to: { path: "^packages/server" },
    },
    {
      name: "no-client-from-systems",
      comment: "systems/* must not import packages/client (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^systems/" },
      to: { path: "^packages/client" },
    },
    {
      name: "shared-must-not-import-server",
      comment: "packages/shared must not import packages/server (REQ-ARQ-002)",
      severity: "error",
      from: { path: "^packages/shared" },
      to: { path: "^packages/server" },
    },
    {
      name: "shared-must-not-import-client",
      comment: "packages/shared must not import packages/client (REQ-ARQ-002)",
      severity: "error",
      from: { path: "^packages/shared" },
      to: { path: "^packages/client" },
    },
    {
      name: "shared-must-not-import-system-api",
      comment:
        "packages/shared must not import packages/system-api (REQ-ARQ-002)",
      severity: "error",
      from: { path: "^packages/shared" },
      to: { path: "^packages/system-api" },
    },
    {
      name: "shared-must-not-import-systems",
      comment: "packages/shared must not import systems/* (REQ-ARQ-002)",
      severity: "error",
      from: { path: "^packages/shared" },
      to: { path: "^systems/" },
    },
    {
      name: "engine-2e-must-not-import-server",
      comment:
        "systems/engine-2e must not import packages/server (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^systems/engine-2e" },
      to: { path: "^packages/server" },
    },
    {
      name: "engine-2e-must-not-import-client",
      comment:
        "systems/engine-2e must not import packages/client (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^systems/engine-2e" },
      to: { path: "^packages/client" },
    },
    {
      name: "engine-2e-must-not-import-other-systems",
      comment:
        "systems/engine-2e must not import other systems/* (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^systems/engine-2e" },
      to: { path: "^systems/(?!engine-2e)" },
    },
    {
      name: "pf2e-must-not-import-server",
      comment:
        "systems/pf2e must not import packages/server (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^systems/pf2e" },
      to: { path: "^packages/server" },
    },
    {
      name: "pf2e-must-not-import-client",
      comment:
        "systems/pf2e must not import packages/client (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^systems/pf2e" },
      to: { path: "^packages/client" },
    },
    {
      name: "sf2e-must-not-import-server",
      comment:
        "systems/sf2e must not import packages/server (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^systems/sf2e" },
      to: { path: "^packages/server" },
    },
    {
      name: "sf2e-must-not-import-client",
      comment:
        "systems/sf2e must not import packages/client (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^systems/sf2e" },
      to: { path: "^packages/client" },
    },
    {
      name: "client-core-must-not-import-system-sheets",
      comment:
        "The core client (packages/client/src, outside systems/) must not " +
        "import a system's sheet territory directly — only the system's own " +
        "registered entry point (packages/client/src/systems/pf2e/index.ts). " +
        "F3, DEC-SEP-02: this is the boundary that lets F4 extract " +
        "systems/pf2e/ into the fusion-systems-2e repo without touching the " +
        "core. __tests__ are exempt (fixtures may reach into a system for " +
        "assertions, e.g. combatSetup.test.ts seeding the real PF2e skill table).",
      severity: "error",
      from: { path: "^packages/client/src/(?!systems/)", pathNot: "__tests__" },
      to: { path: "^packages/client/src/systems/pf2e/(?!index\\.ts$)" },
    },
    {
      name: "client-core-must-not-import-system-packages",
      comment:
        "The core client must not import a game-system package " +
        "(@fusion/system-pf2e, @fusion/system-sf2e) directly — that is " +
        "pre-F4 territory reserved for code living under " +
        "packages/client/src/systems/*/ (F3, DEC-SEP-02/03). __tests__ are " +
        "exempt (e.g. lib/contacts/__tests__/contactsVM.test.ts uses the " +
        "real system packages as fixtures).",
      severity: "error",
      from: {
        path: "^packages/client/src/(?!systems/)",
        pathNot: "__tests__",
      },
      to: { path: "^systems/(pf2e|sf2e)/" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    moduleSystems: ["es6", "cjs"],
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
