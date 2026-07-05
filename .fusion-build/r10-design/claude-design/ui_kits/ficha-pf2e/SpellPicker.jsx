// Spell compendium picker modal — search, rank/trait filters, results.
const { Modal, SearchBox, Chip, ResultRow, Button } = window.FusionVTTDesignSystem_1daa5f;

function SpellPicker({ results, onClose }) {
  const [query, setQuery] = React.useState("");
  const [rank, setRank] = React.useState(1);
  const [trait, setTrait] = React.useState(null);
  const [selected, setSelected] = React.useState("Rajada de Força");

  const traits = ["Evocation", "Conjuration", "Mental", "Force"];
  const filtered = results.filter((r) => {
    if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (rank != null && r.rank !== rank) return false;
    if (trait && !r.traits.includes(trait)) return false;
    return true;
  });

  return (
    <Modal
      title="Adicionar magia — Magus (Arcana)"
      onClose={onClose}
      footerNote="Dados mecânicos ORC — prosa não incluída (clean-room)"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={onClose}>Adicionar ao grimório</Button>
      </>}
    >
      <SearchBox value={query} onChange={(e) => setQuery(e.target.value)} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {[0, 1, 2].map((n) => (
          <Chip key={n} active={rank === n} onClick={() => setRank(rank === n ? null : n)}>{n}</Chip>
        ))}
        <div style={{ width: 1, height: 16, background: "var(--fusion-border)", margin: "0 4px" }} />
        <Chip fixed>Tradição: Arcana</Chip>
        <div style={{ width: 1, height: 16, background: "var(--fusion-border)", margin: "0 4px" }} />
        {traits.map((t) => (
          <Chip key={t} active={trait === t} onClick={() => setTrait(trait === t ? null : t)}>{t}</Chip>
        ))}
      </div>

      <div style={{
        display: "flex", flexDirection: "column", gap: 4,
        border: "1px solid var(--fusion-border)", borderRadius: "var(--fusion-radius)",
        padding: 4, maxHeight: 340, overflowY: "auto",
      }}>
        {filtered.length === 0 && (
          <div style={{ padding: "32px 12px", textAlign: "center", fontSize: 13, color: "var(--fusion-text-muted)" }}>
            Nenhuma magia encontrada com esses filtros.
          </div>
        )}
        {filtered.map((r) => (
          <ResultRow
            key={r.name}
            rank={r.rank}
            actionCost={r.actionCost}
            name={r.name}
            traits={r.traits}
            source={r.source}
            selected={selected === r.name}
            onClick={() => setSelected(r.name)}
          />
        ))}
      </div>
    </Modal>
  );
}

window.SpellPicker = SpellPicker;
