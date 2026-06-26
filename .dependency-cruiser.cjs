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
