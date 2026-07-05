// Magias tab — sub-tabs by origin (Magus / Alquimista / Foco / Rituais).
const { Chip, SpellChip, SpellSlotCard, SpellSlotEmpty, ProficiencyBadge, Button } =
  window.FusionVTTDesignSystem_1daa5f;

function SectionLabel({ children, hint }) {
  return (
    <h3 style={{
      fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
      color: "var(--fusion-text-muted)", margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8,
    }}>
      {children}
      {hint && <span style={{ fontSize: 10.5, fontWeight: 400, textTransform: "none", color: "var(--fusion-text-subtle)", letterSpacing: 0 }}>{hint}</span>}
    </h3>
  );
}

function StatsBar({ items }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 18,
      background: "var(--fusion-surface-alt)", border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius)", padding: "10px 14px",
    }}>
      {items.map((it) => (
        <div key={it.lbl} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--fusion-text-subtle)" }}>{it.lbl}</span>
          {it.badge
            ? <ProficiencyBadge rank={it.badge} variant="filled" size={20} />
            : <span style={{ fontSize: 15, fontWeight: 700, color: "var(--fusion-text)", fontFamily: "var(--fusion-font-mono)" }}>{it.val}</span>}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ msg }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "60px 20px", color: "var(--fusion-text-muted)", textAlign: "center" }}>
      <div style={{ fontSize: 32, color: "var(--fusion-text-subtle)" }}>{"\u26AB"}</div>
      <div style={{ fontSize: 13, maxWidth: 380, lineHeight: 1.5 }}>{msg}</div>
    </div>
  );
}

function MagiasTab({ c, onAddSpell }) {
  const [origin, setOrigin] = React.useState("Magus");
  const s = c.spells;
  const origins = ["Magus", "Alquimista (Arquétipo)", "Foco", "Rituais"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {origins.map((o) => (
          <Chip key={o} active={o === origin} onClick={() => setOrigin(o)}>{o}</Chip>
        ))}
      </div>

      {origin === "Magus" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <StatsBar items={[
            { lbl: "CD de Magia", val: s.dc },
            { lbl: "Ataque", val: s.attack },
            { lbl: "Tradição", val: s.tradition },
            { lbl: "Atributo", val: s.keyAttr },
            { lbl: "Proficiência", badge: s.prof },
          ]} />

          <div>
            <SectionLabel hint="elevados ao patamar 2">Truques</SectionLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {s.cantrips.map((n) => <SpellChip key={n} name={n} onAction={() => {}} />)}
            </div>
          </div>

          {s.ranks.map((r) => (
            <div key={r.rank}>
              <SectionLabel>Patamar {r.rank}</SectionLabel>
              <div style={{ display: "flex", gap: 10 }}>
                {r.prepared.map((p) => (
                  <SpellSlotCard key={p.name} name={p.name} available={p.available} onCast={() => {}} onSwap={() => {}} />
                ))}
                {Array.from({ length: r.openSlots }).map((_, i) => <SpellSlotEmpty key={i} />)}
              </div>
            </div>
          ))}

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <SectionLabel>Grimório</SectionLabel>
              <Button variant="primary" size="sm" onClick={onAddSpell}>+ Adicionar magia</Button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {s.grimoire.map((n) => <SpellChip key={n} name={n} actionLabel="Preparar" onAction={() => {}} />)}
            </div>
          </div>
        </div>
      )}

      {origin === "Alquimista (Arquétipo)" && (
        <EmptyState msg="Este arquétipo não concede magias — itens alquímicos ficam no Inventário." />
      )}

      {origin === "Foco" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <StatsBar items={[{ lbl: "Pontos de Foco", val: `${c.focus.filled} / máx ${c.focus.total}` }]} />
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--fusion-surface-alt)", border: "1px solid var(--fusion-border)", borderRadius: "var(--fusion-radius)", padding: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{s.focusSpell.name}</div>
              <div style={{ fontSize: 11, color: "var(--fusion-text-subtle)", marginTop: 2 }}>{s.focusSpell.note}</div>
            </div>
            <Button variant="primary" size="sm">Lançar</Button>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fusion-text-muted)", background: "var(--fusion-surface-alt)", border: "1px solid var(--fusion-border)", borderRadius: "var(--fusion-radius-sm)", padding: "8px 10px" }}>
            <strong style={{ color: "var(--fusion-text)" }}>Refocus:</strong> recupere 1 Ponto de Foco após 10 minutos de descanso concentrando-se na prática da sua classe.
          </div>
        </div>
      )}

      {origin === "Rituais" && <EmptyState msg="Nenhum ritual conhecido" />}
    </div>
  );
}

window.MagiasTab = MagiasTab;
