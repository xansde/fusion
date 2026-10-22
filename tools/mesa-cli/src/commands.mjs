/**
 * commands.mjs - the mesa-cli commands. Each takes a connected session (session.mjs) and
 * returns plain data; `human` turns that data into text. Every write is an op the
 * server already accepts from the GM's browser - nothing is special-cased here.
 */
import { MesaError } from "./session.mjs";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Walk `a.b.0.c` into a value. */
export function getPath(obj, path) {
  let cur = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new MesaError(`${what} is not valid JSON: ${text}`, "BAD_JSON");
  }
}

/** Find a document by id in any collection of the snapshot, returning { type, doc }. */
function findDocById(session, id) {
  for (const [type, list] of Object.entries(session.snapshot.documents ?? {})) {
    const doc = (list ?? []).find((d) => d && d._id === id);
    if (doc) return { type, doc };
  }
  return null;
}

function resolveByName(list, ref, label) {
  const byId = list.find((d) => d._id === ref);
  if (byId) return byId;
  const q = ref.toLowerCase();
  const exact = list.filter((d) => String(d.name).toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const pool = exact.length > 1 ? exact : list.filter((d) => String(d.name).toLowerCase().includes(q));
  if (pool.length === 1) return pool[0];
  if (pool.length === 0) throw new MesaError(`No ${label} matches "${ref}".`, `${label.toUpperCase()}_NOT_FOUND`);
  const names = pool
    .slice(0, 8)
    .map((d) => `${d.name} (${d._id})`)
    .join("; ");
  throw new MesaError(`"${ref}" is ambiguous: ${names}`, `${label.toUpperCase()}_AMBIGUOUS`);
}

/** Actor by id, exact name, then unique case-insensitive substring. */
export function resolveActor(session, ref) {
  return resolveByName(session.docs("Actor"), ref, "actor");
}

/** Embedded items of an actor, wherever the snapshot keeps them. */
export function itemsOf(session, actor) {
  if (Array.isArray(actor.items)) return actor.items;
  return session
    .docs("Item")
    .filter((i) => i.parent === actor._id || i.parentId === actor._id || i.actorId === actor._id);
}

function need(args, n, usage) {
  if (args.length < n) throw new MesaError(`Usage: mesa ${usage}`, "USAGE");
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

export const commands = {
  status: {
    usage: "status",
    async run(session) {
      const sceneId = session.snapshot.activeSceneId;
      const scene = sceneId ? session.docs("Scene").find((s) => s._id === sceneId) : null;
      return {
        world: { id: session.world.id, title: session.world.title, systemId: session.world.systemId },
        activeScene: scene ? { id: scene._id, name: scene.name } : null,
        seq: session.snapshot.seq,
        me: { id: session.user?.id, name: session.user?.name },
        users: (session.roster ?? session.world.users ?? []).map((u) => ({
          id: u.userId ?? u.id,
          name: u.userName ?? u.name,
          online: u.online ?? null,
        })),
      };
    },
    human(d) {
      const online = d.users.filter((u) => u.online).map((u) => u.name);
      return [
        `Mundo: ${d.world.title} (${d.world.id}) - sistema ${d.world.systemId}`,
        `Cena ativa: ${d.activeScene ? `${d.activeScene.name} (${d.activeScene.id})` : "nenhuma"}`,
        `Conectados: ${online.length ? online.join(", ") : "ninguem"} (de ${d.users.length} usuarios)`,
        `Eu: ${d.me.name}  seq: ${d.seq}`,
      ].join("\n");
    },
  },

  actors: {
    usage: "actors [--type <type>]",
    async run(session, _args, flags) {
      return session
        .docs("Actor")
        .filter((a) => !flags.type || a.type === flags.type)
        .map((a) => ({ id: a._id, name: a.name, type: a.type }));
    },
    human: (d) =>
      d.length ? d.map((a) => `${a.id}  ${String(a.type).padEnd(10)}  ${a.name}`).join("\n") : "(nenhum ator)",
  },

  actor: {
    usage: "actor <id|name>",
    async run(session, args) {
      need(args, 1, this.usage);
      const a = resolveActor(session, args[0]);
      const items = itemsOf(session, a);
      return {
        id: a._id,
        name: a.name,
        type: a.type,
        derived: a.system?.derived ?? null,
        hp: a.system?.attributes?.hp ?? null,
        items: items.map((i) => ({ id: i._id, name: i.name, type: i.type })),
        conditions: items.filter((i) => i.type === "condition").map((i) => i.system?.slug ?? i.name),
      };
    },
    human(d) {
      const hp = d.hp ? `HP ${d.hp.value}/${d.hp.max}` : "HP ?";
      return [
        `${d.name} [${d.type}] ${d.id}`,
        hp,
        `Itens: ${d.items.length}${d.conditions.length ? `  Condicoes: ${d.conditions.join(", ")}` : ""}`,
        `Derivado: ${d.derived ? JSON.stringify(d.derived).slice(0, 400) : "-"}`,
      ].join("\n");
    },
  },

  get: {
    usage: "get <id|name> <path>",
    async run(session, args) {
      need(args, 2, this.usage);
      const found = findDocById(session, args[0]) ?? { type: "Actor", doc: resolveActor(session, args[0]) };
      return { id: found.doc._id, type: found.type, path: args[1], value: getPath(found.doc, args[1]) ?? null };
    },
    human: (d) => (typeof d.value === "string" ? d.value : JSON.stringify(d.value, null, 2)),
  },

  set: {
    usage: "set <id|name> <path> <json>",
    async run(session, args) {
      need(args, 3, this.usage);
      const found = findDocById(session, args[0]) ?? { type: "Actor", doc: resolveActor(session, args[0]) };
      const value = parseJson(args.slice(2).join(" "), "value");
      const ack = await session.op("doc:update", {
        documentType: found.type,
        updates: [{ _id: found.doc._id, diff: { [args[1]]: value } }],
      });
      return { id: found.doc._id, type: found.type, path: args[1], value, ack: ack.result ?? null };
    },
    human: (d) => `${d.type} ${d.id}: ${d.path} = ${JSON.stringify(d.value)}`,
  },

  "item-add": {
    usage: "item-add <actor> <json>",
    async run(session, args) {
      need(args, 2, this.usage);
      const a = resolveActor(session, args[0]);
      const data = parseJson(args.slice(1).join(" "), "item");
      const ack = await session.op("doc:create", {
        documentType: "Item",
        parent: { type: "Actor", id: a._id },
        data: Array.isArray(data) ? data : [data],
      });
      const docs = ack.result?.documents ?? [];
      return { actor: a._id, created: docs.map((d) => ({ id: d._id, name: d.name, type: d.type })) };
    },
    human: (d) => d.created.map((i) => `+ ${i.name} [${i.type}] ${i.id}`).join("\n") || "(nada criado)",
  },

  "item-rm": {
    usage: "item-rm <actor> <item-id|name>",
    async run(session, args) {
      need(args, 2, this.usage);
      const a = resolveActor(session, args[0]);
      const items = itemsOf(session, a);
      const q = args[1].toLowerCase();
      const hit = items.find((i) => i._id === args[1]) ?? items.find((i) => String(i.name).toLowerCase() === q);
      if (!hit) throw new MesaError(`Actor ${a.name} has no item "${args[1]}".`, "ITEM_NOT_FOUND");
      await session.op("doc:delete", {
        documentType: "Item",
        ids: [hit._id],
        parent: { type: "Actor", id: a._id },
      });
      return { actor: a._id, removed: { id: hit._id, name: hit.name } };
    },
    human: (d) => `- ${d.removed.name} ${d.removed.id}`,
  },

  op: {
    usage: 'op <json>   (envelope: {"type":"...","payload":{...}})',
    async run(session, args) {
      need(args, 1, this.usage);
      const env = parseJson(args.join(" "), "envelope");
      if (typeof env?.type !== "string") throw new MesaError('Envelope needs a string "type".', "USAGE");
      return session.op(env.type, env.payload ?? {});
    },
    human: (d) => JSON.stringify(d, null, 2),
  },

  chat: {
    usage: "chat <text>",
    async run(session, args) {
      need(args, 1, this.usage);
      const ack = await session.op("chat:send", { content: args.join(" "), worldId: session.world.id });
      return { ok: true, message: ack.result ?? null };
    },
    human: () => "mensagem enviada",
  },

  scene: {
    usage: "scene <id|name>",
    async run(session, args) {
      need(args, 1, this.usage);
      const s = resolveByName(session.docs("Scene"), args.join(" "), "scene");
      await session.op("world:activeScene", { sceneId: s._id });
      return { id: s._id, name: s.name };
    },
    human: (d) => `cena ativa: ${d.name} (${d.id})`,
  },

  hp: {
    usage: "hp <actor> <value|+n|-n>",
    async run(session, args) {
      need(args, 2, this.usage);
      const a = resolveActor(session, args[0]);
      const cur = a.system?.attributes?.hp;
      if (!cur || typeof cur.value !== "number") {
        throw new MesaError(`${a.name} has no system.attributes.hp.value to change.`, "NO_HP");
      }
      const raw = args[1];
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new MesaError(`HP "${raw}" is not a number.`, "USAGE");
      const next = /^[+-]/.test(raw) ? cur.value + n : n;
      await session.op("doc:update", {
        documentType: "Actor",
        updates: [{ _id: a._id, diff: { "system.attributes.hp.value": next } }],
      });
      return { id: a._id, name: a.name, before: cur.value, after: next, max: cur.max ?? null };
    },
    human: (d) => `${d.name}: HP ${d.before} -> ${d.after}${d.max !== null ? `/${d.max}` : ""}`,
  },

  condition: {
    usage: "condition <actor> <slug> [value|off]",
    async run(session, args) {
      need(args, 2, this.usage);
      const a = resolveActor(session, args[0]);
      const slug = args[1];
      const arg = args[2];
      let mode = "add";
      let value;
      if (arg === "off") mode = "remove";
      else if (arg !== undefined) {
        value = Number(arg);
        if (!Number.isFinite(value)) throw new MesaError(`Condition value "${arg}" is not a number.`, "USAGE");
        mode = "set";
      }
      await session.op("actor:applyCondition", {
        targetTokenIds: [],
        selfActorId: a._id,
        slug,
        mode,
        ...(value !== undefined ? { value } : {}),
      });
      return { id: a._id, name: a.name, slug, mode, value: value ?? null };
    },
    human: (d) => `${d.name}: ${d.slug} ${d.mode}${d.value !== null ? ` ${d.value}` : ""}`,
  },
};

export function listCommands() {
  return Object.values(commands).map((c) => c.usage);
}
