/** argv parsing for the mesa CLI. */
/** Split argv into flags (--url, --user, --password, --type, --json) and positionals. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  const valued = new Set(["url", "user", "password", "type"]);
  // `pnpm mesa -- <cmd>` may forward the literal "--".
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") continue;
    if (a.startsWith("--") && a.length > 2) {
      const eq = a.indexOf("=");
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (valued.has(name)) flags[name] = eq === -1 ? args[++i] : a.slice(eq + 1);
      else flags[name] = true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}
