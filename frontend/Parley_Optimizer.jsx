// ParlayOptimizer.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Intégration ParlayEdge — importer et ajouter comme tab/page dans ton app
//
// import ParlayOptimizer from './components/ParlayOptimizer';
//
// Variables d'env (Vite) :
//   VITE_API_URL=https://your-render-app.onrender.com
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "";

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:      "#07090f",
  surface: "#0e1118",
  card:    "#131824",
  border:  "#1c2438",
  text:    "#dde3f0",
  muted:   "#4a5570",
  green:   "#00e87a",
  red:     "#ff4d5a",
  amber:   "#f5a623",
  blue:    "#4a9eff",
};

// ── Utility ───────────────────────────────────────────────────────────────────
const toDecimal = (american) => {
  const o = parseFloat(american);
  if (isNaN(o)) return null;
  return o >= 0 ? o / 100 + 1 : 100 / Math.abs(o) + 1;
};

const toAmerican = (dec) => {
  if (dec >= 2) return `+${Math.round((dec - 1) * 100)}`;
  return `${Math.round(-100 / (dec - 1))}`;
};

const impliedProb = (american) => {
  const o = parseFloat(american);
  return o < 0 ? Math.abs(o) / (Math.abs(o) + 100) : 100 / (o + 100);
};

const pct = (n, decimals = 1) =>
  n != null ? `${(n * 100).toFixed(decimals)}%` : "—";

const fmt$ = (n) => `$${n.toFixed(2)}`;

function combos(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...t] = arr;
  return [
    ...combos(t, k - 1).map((c) => [h, ...c]),
    ...combos(t, k),
  ];
}

// ── Value badge ───────────────────────────────────────────────────────────────
function ValueBadge({ edge }) {
  if (edge == null) return <span style={{ color: C.muted, fontSize: 11 }}>—</span>;
  const positive = edge > 0;
  const color = edge > 0.05 ? C.green : edge > 0 ? "#80d4a0" : edge > -0.05 ? C.amber : C.red;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 7px",
      borderRadius: 3, letterSpacing: "0.03em",
      background: `${color}18`, color, border: `1px solid ${color}30`,
    }}>
      {positive ? "+" : ""}{(edge * 100).toFixed(1)}%
    </span>
  );
}

// ── Form pills ────────────────────────────────────────────────────────────────
function FormPills({ form }) {
  if (!form) return null;
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {form.split("").map((c, i) => (
        <span key={i} style={{
          width: 14, height: 14, borderRadius: 2, fontSize: 9, fontWeight: 700,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: c === "W" ? C.green : c === "D" ? C.amber : C.red,
          color: "#000",
        }}>{c}</span>
      ))}
    </span>
  );
}

// ── Odds chip ─────────────────────────────────────────────────────────────────
function OddsChip({ odds }) {
  const n = parseFloat(odds);
  const pos = n > 0;
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 3,
      background: pos ? `${C.green}15` : `${C.red}15`,
      color: pos ? C.green : "#ff8a8a",
      border: `1px solid ${pos ? C.green + "25" : C.red + "25"}`,
      fontFamily: "'IBM Plex Mono', monospace",
      whiteSpace: "nowrap",
    }}>
      {odds}
    </span>
  );
}

// ── Inline text input ─────────────────────────────────────────────────────────
function Input({ style, ...props }) {
  const [focus, setFocus] = useState(false);
  return (
    <input
      {...props}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        background: C.bg,
        border: `1px solid ${focus ? C.blue : C.border}`,
        borderRadius: 4, color: C.text,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 12, padding: "7px 10px", outline: "none",
        transition: "border-color 0.15s",
        ...style,
      }}
    />
  );
}

// ── Button ────────────────────────────────────────────────────────────────────
function Btn({ primary, danger, small, style, ...props }) {
  return (
    <button
      {...props}
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: 700, fontSize: small ? 10 : 11,
        letterSpacing: "0.06em", textTransform: "uppercase",
        border: "none", borderRadius: 4, cursor: "pointer",
        padding: small ? "4px 10px" : "7px 14px",
        background: primary ? C.green : danger ? `${C.red}20` : C.card,
        color: primary ? "#000" : danger ? C.red : C.muted,
        border: `1px solid ${primary ? C.green : danger ? C.red + "40" : C.border}`,
        transition: "opacity 0.15s",
        ...(props.disabled ? { opacity: 0.4, cursor: "not-allowed" } : {}),
        ...style,
      }}
    />
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, color: C.muted, textTransform: "uppercase",
      letterSpacing: "0.14em", marginBottom: 12,
      fontFamily: "'IBM Plex Mono', monospace",
    }}>
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ParlayOptimizer() {
  // Tabs: "matches" | "builder"
  const [tab, setTab]             = useState("matches");
  const [matches, setMatches]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  // Picks added to builder
  const [picks, setPicks]         = useState([]);

  // Builder config
  const [legSize, setLegSize]     = useState(3);
  const [stake, setStake]         = useState(20);
  const [selected, setSelected]   = useState(new Set());  // parlay ids
  const [sortBy, setSortBy]       = useState("value");    // "value" | "odds"

  // Manual add form
  const [manual, setManual]       = useState({ team: "", matchup: "", odds: "" });

  // Filter
  const [minValue, setMinValue]   = useState(-99);        // only show matches with value >= X

  // ── Fetch upcoming matches ─────────────────────────────────────────────────
  const fetchMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/parlay/upcoming`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setMatches(data.matches || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  // ── Add pick from match ────────────────────────────────────────────────────
  const addPick = (match, side) => {
    const team  = side === "home" ? match.home_team : match.away_team;
    const odds  = match.odds[side];
    const edge  = match.value?.[side] ?? null;
    const matchup = `${match.home_team} vs ${match.away_team}`;
    // Avoid duplicates (same match)
    if (picks.some((p) => p.matchup === matchup)) return;
    const pick = {
      id:         `${match.id}_${side}`,
      team, matchup, odds,
      value_edge: edge,
      real_prob:  match.real_prob?.[side] ?? null,
      implied_prob: match.implied_prob?.[side] ?? null,
    };
    setPicks((prev) => [...prev, pick]);
    setTab("builder");
  };

  // ── Manual pick ────────────────────────────────────────────────────────────
  const addManual = () => {
    if (!manual.team.trim() || !manual.odds.trim()) return;
    const dec = toDecimal(manual.odds);
    if (!dec) return;
    const imp = impliedProb(manual.odds);
    setPicks((prev) => [
      ...prev,
      {
        id:          Date.now().toString(),
        team:        manual.team.trim(),
        matchup:     manual.matchup.trim() || manual.team.trim(),
        odds:        manual.odds.trim(),
        value_edge:  null,
        real_prob:   null,
        implied_prob: imp,
      },
    ]);
    setManual({ team: "", matchup: "", odds: "" });
  };

  const removePick = (id) => setPicks((prev) => prev.filter((p) => p.id !== id));

  // ── Generate parlays ───────────────────────────────────────────────────────
  const parlays = useMemo(() => {
    if (picks.length < legSize) return [];
    return combos(picks, legSize).map((legs) => {
      const dec     = legs.reduce((a, p) => a * toDecimal(p.odds), 1);
      const win     = stake * dec - stake;
      const edges   = legs.map((l) => l.value_edge).filter((v) => v != null);
      const avgEdge = edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : null;
      const id      = legs.map((l) => l.id).join("|");
      return { id, legs, dec, win, american: toAmerican(dec), avgEdge };
    });
  }, [picks, legSize, stake]);

  const sortedParlays = useMemo(() => {
    return [...parlays].sort((a, b) => {
      if (sortBy === "value") {
        return (b.avgEdge ?? -99) - (a.avgEdge ?? -99);
      }
      return b.dec - a.dec;
    });
  }, [parlays, sortBy]);

  const selectedList = sortedParlays.filter((p) => selected.has(p.id));
  const totalRisk    = selectedList.length * stake;
  const totalMaxWin  = selectedList.reduce((s, p) => s + p.win, 0);

  // ── Filtered matches ───────────────────────────────────────────────────────
  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      if (!m.value) return minValue <= 0;
      return Math.max(m.value.home ?? -99, m.value.away ?? -99) >= minValue;
    });
  }, [matches, minValue]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh", background: C.bg, color: C.text,
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      padding: "20px 16px", maxWidth: 1000, margin: "0 auto",
    }}>
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600;700&display=swap"
        rel="stylesheet"
      />

      {/* ── Header ── */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{
            margin: 0, fontSize: 20, fontWeight: 700, color: C.green,
            fontFamily: "'IBM Plex Sans', sans-serif", letterSpacing: "-0.3px",
          }}>
            ⬡ Parlay Optimizer
          </h1>
          <p style={{ margin: "3px 0 0", fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Value model · Parlay builder · Diversification
          </p>
        </div>
        <div style={{ flex: 1 }} />
        {/* Picks counter pill */}
        {picks.length > 0 && (
          <div style={{
            background: `${C.green}15`, border: `1px solid ${C.green}30`,
            borderRadius: 20, padding: "4px 12px", fontSize: 11, color: C.green,
          }}>
            {picks.length} pick{picks.length > 1 ? "s" : ""} · {combos(picks, legSize).length} combos
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
        {["matches", "builder"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${tab === t ? C.green : "transparent"}`,
              color: tab === t ? C.green : C.muted,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
              textTransform: "uppercase", padding: "8px 16px",
              cursor: "pointer", transition: "color 0.15s",
              marginBottom: -1,
            }}
          >
            {t === "builder" && picks.length > 0
              ? `Builder (${picks.length})`
              : t === "matches" && filteredMatches.length > 0
              ? `Matchs (${filteredMatches.length})`
              : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ════════════════════ TAB: MATCHES ════════════════════ */}
      {tab === "matches" && (
        <div>
          {/* Toolbar */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <Btn primary onClick={fetchMatches} disabled={loading}>
              {loading ? "Chargement…" : "↻ Actualiser"}
            </Btn>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Filtre Value ≥
              </span>
              {[[-99, "Tous"], [0, "+EV only"], [0.05, "+5%"], [0.10, "+10%"]].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setMinValue(val)}
                  style={{
                    background: minValue === val ? `${C.green}18` : "transparent",
                    color: minValue === val ? C.green : C.muted,
                    border: `1px solid ${minValue === val ? C.green + "40" : C.border}`,
                    borderRadius: 4, padding: "4px 9px",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10, cursor: "pointer", textTransform: "uppercase",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{
              background: `${C.red}15`, border: `1px solid ${C.red}40`,
              borderRadius: 6, padding: "10px 14px", marginBottom: 16,
              fontSize: 12, color: C.red,
            }}>
              ⚠ {error} — vérifie tes clés API dans les variables d'env Render
            </div>
          )}

          {loading && (
            <div style={{ textAlign: "center", padding: 40, color: C.muted, fontSize: 12 }}>
              Analyse des matchs en cours…
            </div>
          )}

          {!loading && filteredMatches.length === 0 && !error && (
            <div style={{ textAlign: "center", padding: 40, color: C.muted, fontSize: 12 }}>
              Aucun match trouvé — ajuste le filtre ou actualise
            </div>
          )}

          {filteredMatches.map((m) => {
            const alreadyPicked = (side) =>
              picks.some((p) => p.id === `${m.id}_${side}`);

            return (
              <div key={m.id} style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 7, padding: "14px 16px", marginBottom: 10,
              }}>
                {/* Match header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'IBM Plex Sans', sans-serif", color: C.text }}>
                      {m.home_team} <span style={{ color: C.muted, fontSize: 11 }}>vs</span> {m.away_team}
                    </div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {m.sport.replace("soccer_", "").replace(/_/g, " ")} ·{" "}
                      {m.commence_time
                        ? new Date(m.commence_time).toLocaleDateString("fr-CA", {
                            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                          })
                        : "Date inconnue"}
                    </div>
                  </div>
                  {m.real_prob && (
                    <div style={{ fontSize: 10, color: C.muted, textAlign: "right" }}>
                      <div>Rank gap: <span style={{ color: C.amber }}>{m.real_prob.rank_gap}</span></div>
                      <div style={{ display: "flex", gap: 4, marginTop: 4, justifyContent: "flex-end" }}>
                        <FormPills form={m.real_prob.home_form} />
                        <span style={{ color: C.muted }}>vs</span>
                        <FormPills form={m.real_prob.away_form} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Sides table */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {["home", "away"].map((side) => {
                    const team     = side === "home" ? m.home_team : m.away_team;
                    const odds     = m.odds[side];
                    const imp      = m.implied_prob?.[side];
                    const real     = m.real_prob?.[side];
                    const edge     = m.value?.[side];
                    const picked   = alreadyPicked(side);
                    const isValue  = edge != null && edge > 0;

                    return (
                      <div
                        key={side}
                        style={{
                          background: isValue ? `${C.green}08` : C.surface,
                          border: `1px solid ${isValue ? C.green + "30" : C.border}`,
                          borderRadius: 5, padding: "10px 12px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Sans', sans-serif" }}>
                            {team}
                          </div>
                          <OddsChip odds={String(odds)} />
                        </div>

                        {/* Stats row */}
                        <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: 10, color: C.muted }}>
                            Implicite <span style={{ color: C.text }}>{pct(imp)}</span>
                          </div>
                          <div style={{ fontSize: 10, color: C.muted }}>
                            Réel <span style={{ color: real != null ? C.green : C.muted }}>{pct(real)}</span>
                          </div>
                          {m.real_prob && (
                            <div style={{ fontSize: 10, color: C.muted }}>
                              PPG <span style={{ color: C.text }}>
                                {side === "home" ? m.real_prob.home_ppg : m.real_prob.away_ppg}
                              </span>
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 10, color: C.muted }}>Edge</span>
                            <ValueBadge edge={edge} />
                          </div>
                          <Btn
                            small
                            primary={isValue && !picked}
                            disabled={picked}
                            onClick={() => addPick(m, side)}
                          >
                            {picked ? "✓ Ajouté" : isValue ? "★ Ajouter" : "+ Pick"}
                          </Btn>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ════════════════════ TAB: BUILDER ════════
