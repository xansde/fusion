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
      comment:
        "systems/* (core or satellite, F4 DEC-SEP-09) must not import packages/server (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^(systems/|external/fusion-systems-2e/systems/)" },
      to: { path: "^packages/server" },
    },
    {
      name: "no-client-from-systems",
      comment:
        "systems/* (core or satellite, F4 DEC-SEP-09) must not import packages/client (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^(systems/|external/fusion-systems-2e/systems/)" },
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
        "external/fusion-systems-2e/systems/engine-2e must not import packages/server (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^external/fusion-systems-2e/systems/engine-2e" },
      to: { path: "^packages/server" },
    },
    {
      name: "engine-2e-must-not-import-client",
      comment:
        "external/fusion-systems-2e/systems/engine-2e must not import packages/client (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^external/fusion-systems-2e/systems/engine-2e" },
      to: { path: "^packages/client" },
    },
    {
      name: "engine-2e-must-not-import-other-systems",
      comment:
        "external/fusion-systems-2e/systems/engine-2e must not import other systems/* (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^external/fusion-systems-2e/systems/engine-2e" },
      to: { path: "^external/fusion-systems-2e/systems/(?!engine-2e)" },
    },
    {
      name: "pf2e-must-not-import-server",
      comment:
        "external/fusion-systems-2e/systems/pf2e must not import packages/server (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^external/fusion-systems-2e/systems/pf2e" },
      to: { path: "^packages/server" },
    },
    {
      name: "pf2e-must-not-import-client",
      comment:
        "external/fusion-systems-2e/systems/pf2e must not import packages/client (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^external/fusion-systems-2e/systems/pf2e" },
      to: { path: "^packages/client" },
    },
    {
      name: "sf2e-must-not-import-server",
      comment:
        "external/fusion-systems-2e/systems/sf2e must not import packages/server (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^external/fusion-systems-2e/systems/sf2e" },
      to: { path: "^packages/server" },
    },
    {
      name: "sf2e-must-not-import-client",
      comment:
        "external/fusion-systems-2e/systems/sf2e must not import packages/client (REQ-ARQ-005)",
      severity: "error",
      from: { path: "^external/fusion-systems-2e/systems/sf2e" },
      to: { path: "^packages/client" },
    },
    {
      name: "client-core-must-not-import-system-sheets",
      comment:
        "The core client (packages/client/src) must not import a system's " +
        "sheet territory directly — only the system's own registered entry " +
        "point, consumed as the @fusion/sheets-pf2e package. F4, DEC-SEP-09: " +
        "sheets/pf2e/ now lives in the fusion-systems-2e submodule at " +
        "external/fusion-systems-2e/sheets/pf2e/ — this is the boundary that " +
        "used to let F4 extract it there, and now keeps the core from " +
        "reaching past its published entry point (src/index.ts). __tests__ " +
        "are exempt (fixtures may reach into a system for assertions, e.g. " +
        "combatSetup.test.ts seeding the real PF2e skill table).",
      severity: "error",
      from: { path: "^packages/client/src/", pathNot: "__tests__" },
      to: {
        path: "^external/fusion-systems-2e/sheets/pf2e/(?!src/index\\.ts$)",
      },
    },
    {
      name: "client-core-must-not-import-system-packages",
      comment:
        "The core client must not import a game-system package " +
        "(@fusion/system-pf2e, @fusion/system-sf2e) directly. F4, " +
        "DEC-SEP-09: those now live in the fusion-systems-2e submodule at " +
        "external/fusion-systems-2e/systems/{pf2e,sf2e}/. __tests__ are " +
        "exempt (e.g. lib/contacts/__tests__/contactsVM.test.ts uses the " +
        "real system packages as fixtures).",
      severity: "error",
      from: {
        path: "^packages/client/src/",
        pathNot: "__tests__",
      },
      to: { path: "^external/fusion-systems-2e/systems/(pf2e|sf2e)/" },
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
