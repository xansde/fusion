#!/usr/bin/env node
/**
 * mesa - command-line door into a LIVE Fusion server (logs in like a browser would).
 * See tools/mesa-cli/README.md.
 */
import { connect, MesaError } from "../src/session.mjs";
import { commands, listCommands } from "../src/commands.mjs";
import { parseArgs } from "../src/args.mjs";

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [name, ...rest] = positional;
  if (!name || name === "help" || flags.help) {
    console.log(
      `mesa [--url URL] [--user NAME] [--password PW] [--json] <command>\n\n  ${listCommands().join("\n  ")}`,
    );
    return;
  }
  const cmd = commands[name];
  if (!cmd) throw new MesaError(`Unknown command "${name}". Try: mesa help`, "USAGE");

  const session = await connect({
    url: flags.url ?? process.env.FUSION_URL ?? "http://127.0.0.1:33000",
    user: flags.user ?? process.env.FUSION_USER ?? "Gamemaster",
    password: flags.password ?? process.env.FUSION_PASSWORD,
  });
  try {
    const data = await cmd.run(session, rest, flags);
    console.log(flags.json ? JSON.stringify(data, null, 2) : cmd.human(data));
  } finally {
    session.close();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (process.argv.includes("--json")) {
      console.error(JSON.stringify({ ok: false, code: err.code ?? "ERROR", message: msg }));
    } else {
      console.error(`erro: ${msg}`);
    }
    process.exit(err instanceof MesaError && err.code === "USAGE" ? 2 : 1);
  },
);
