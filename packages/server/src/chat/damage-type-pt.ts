/**
 * damage-type-pt.ts — pt-BR names of the damage types, for the server's own chat lines (the client has
 * its own i18n dictionary, `FUSION.Damage.*`; the server has no i18n runtime). An unknown type is
 * said as it came.
 */
const DAMAGE_TYPE_PT: Readonly<Record<string, string>> = {
  slashing: "cortante",
  piercing: "perfurante",
  bludgeoning: "contundente",
  bleed: "sangramento",
  fire: "fogo",
  cold: "frio",
  acid: "ácido",
  electricity: "eletricidade",
  sonic: "sônico",
  poison: "veneno",
  mental: "mental",
  force: "força",
  vitality: "vitalidade",
  void: "vazio",
  spirit: "espírito",
  precision: "precisão",
  untyped: "sem tipo",
};

export function damageTypePt(type: string): string {
  return DAMAGE_TYPE_PT[type] ?? type;
}
