// Ficha PF2e — the full character-sheet window. Ties every screen together.
const { ModeToggle, Tabs, Panel } = window.FusionVTTDesignSystem_1daa5f;

function FichaApp() {
  const c = window.TOBIAS;
  const [tab, setTab] = React.useState("Magias");
  const [planOpen, setPlanOpen] = React.useState(true);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const tabs = ["Principal", "Perícias", "Ações", "Magias", "Inventário", "Talentos", "Bio"];

  return (
    <div style={{ background: "var(--fusion-bg)", padding: 24, minHeight: "100vh", display: "flex", justifyContent: "center" }}>
      <div style={{
        width: 1280, height: 820, background: "var(--fusion-surface)",
        border: "1px solid var(--fusion-border)", borderRadius: "var(--fusion-radius-lg)",
        overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "var(--fusion-shadow-modal)",
      }}>
        {/* Title bar */}
        <div style={{
          height: 44, flexShrink: 0, background: "var(--fusion-surface-alt)",
          borderBottom: "1px solid var(--fusion-border)", display: "flex", alignItems: "center",
          padding: "0 12px 0 16px", gap: 12,
        }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{c.name} — Magus 3</span>
          <ModeToggle options={["Jogar", "Editar"]} defaultValue="Jogar" />
          <div style={{ flex: 1 }} />
          {!planOpen && (
            <button onClick={() => setPlanOpen(true)} style={{
              background: "transparent", border: "1px solid var(--fusion-border)",
              color: "var(--fusion-text-muted)", fontSize: 11, padding: "4px 8px",
              borderRadius: "var(--fusion-radius-sm)", cursor: "pointer", fontFamily: "var(--fusion-font)",
            }}>Mostrar plano</button>
          )}
          <div style={{ display: "flex", gap: 8, marginLeft: 8 }}>
            <div title="Minimizar" style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--fusion-surface)", border: "1px solid var(--fusion-border)" }} />
            <div title="Fechar" style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--fusion-surface)", border: "1px solid var(--fusion-border)" }} />
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {planOpen && <PlanColumn c={c} onHide={() => setPlanOpen(false)} />}

          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
            <CharacterHeader c={c} />
            <SkillsPanel c={c} />
            <Panel>
              <Tabs tabs={tabs} value={tab} onChange={setTab} />
              <div style={{ paddingTop: 14 }}>
                {tab === "Magias"
                  ? <MagiasTab c={c} onAddSpell={() => setPickerOpen(true)} />
                  : <div style={{ padding: "40px 12px", textAlign: "center", color: "var(--fusion-text-muted)", fontSize: 13 }}>
                      Aba “{tab}” — conteúdo de exemplo omitido nesta recriação.
                    </div>}
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {pickerOpen && <SpellPicker results={window.COMPENDIUM} onClose={() => setPickerOpen(false)} />}
    </div>
  );
}

window.FichaApp = FichaApp;
