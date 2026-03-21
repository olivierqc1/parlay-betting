// frontend/src/AppComponents.jsx
// ── Tous les sous-composants de ParlayEdge ──

// ─── Utils ────────────────────────────────────────────────────────────────────
export const fmtAmerican = n => n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
export const fmtPct = p => `${(p * 100).toFixed(1)}%`;
export const fmtDate = ts => new Date(ts).toLocaleDateString("fr-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function americanToDecimal(o) {
  const n = parseFloat(o);
  return n >= 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}
export function getCombinations(arr, k) {
  if (k === 1) return arr.map(x => [x]);
  const result = [];
  for (let i = 0; i <= arr.length - k; i++)
    getCombinations(arr.slice(i + 1), k - 1).forEach(rest => result.push([arr[i], ...rest]));
  return result;
}
export function edgeColor(e) {
  if (e == null) return "#445";
  if (e > 0.08)  return "#00ff88";
  if (e > 0.03)  return "#88ffcc";
  if (e > 0)     return "#aaffcc";
  if (e > -0.05) return "#ffcc44";
  return "#ff5555";
}
export function confidenceLabel(p) {
  if (p >= 0.65) return { label: "TRÈS SÛR", color: "#00ff88" };
  if (p >= 0.55) return { label: "SÛR",      color: "#88ffcc" };
  if (p >= 0.48) return { label: "PROBABLE", color: "#ffcc44" };
  return              { label: "RISQUÉ",     color: "#ff5555" };
}

// ─── Imports React ────────────────────────────────────────────────────────────
import { useState, useMemo } from "react";

// ─── FormPills ────────────────────────────────────────────────────────────────
export function FormPills({ form }) {
  if (!form) return <span style={{ color: "#334", fontSize: 10 }}>—</span>;
  const col = { W: "#00ff88", D: "#ffcc44", L: "#ff5555" };
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {form.split("").map((c, i) => (
        <span key={i} style={{
          width: 14, height: 14, borderRadius: 2, fontSize: 9, fontWeight: 700,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: col[c] || "#334", color: "#000",
        }}>{c}</span>
      ))}
    </span>
  );
}

// ─── TeamStats ────────────────────────────────────────────────────────────────
export function TeamStats({ stats, label, isHome }) {
  if (!stats) return null;
  const conf = confidenceLabel(isHome
    ? (stats.homeWinRate || stats.ppg / 3)
    : (stats.awayWinRate || stats.ppg / 3));
  return (
    <div style={{ background: "#0a0f1a", borderRadius: 6, padding: "8px 10px", flex: 1 }}>
      <div style={{ fontSize: 9, color: "#445", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 9, color: "#445" }}>Rang</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>#{stats.rank}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#445" }}>PPG</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: stats.ppg >= 2 ? "#00ff88" : stats.ppg >= 1.5 ? "#ffcc44" : "#ff5555" }}>{stats.ppg}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#445" }}>Buts/m</div>
          <div style={{ fontSize: 13, color: "#88aacc" }}>
            {stats.gpgFor}<span style={{ color: "#334" }}>/</span><span style={{ color: "#ff8888" }}>{stats.gpgAgainst}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#445", marginBottom: 2 }}>Forme</div>
          <FormPills form={stats.form} />
        </div>
        <div style={{ marginLeft: "auto" }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: conf.color, background: conf.color + "22", padding: "2px 6px", borderRadius: 10 }}>{conf.label}</span>
        </div>
      </div>
    </div>
  );
}

// ─── MatchCard ────────────────────────────────────────────────────────────────
export function MatchCard({ match, picks, onPick }) {
  const [expanded, setExpanded] = useState(false);
  const alreadyPicked = side => picks.some(p => p.matchId === match.id && p.side === side);

  return (
    <div style={{ background: "#0f1320", border: "1px solid #1e2535", borderRadius: 10, marginBottom: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", cursor: "pointer" }} onClick={() => setExpanded(v => !v)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#dde3f0" }}>
              {match.homeTeam} <span style={{ color: "#445", fontSize: 10 }}>vs</span> {match.awayTeam}
            </div>
            <div style={{ fontSize: 10, color: "#445", marginTop: 2 }}>
              {match.sportLabel} · {fmtDate(match.commenceTime)}
              {match.hasModel && match.rankGap != null && (
                <span style={{ color: "#ffcc44", marginLeft: 8 }}>Écart rang: {match.rankGap}/{match.totalTeams}</span>
              )}
            </div>
          </div>
          <span style={{ fontSize: 11, color: "#334" }}>{expanded ? "▲" : "▼"}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: match.odds.draw != null ? "1fr 1fr 1fr" : "1fr 1fr", gap: 6 }}>
          {["home", "away", ...(match.odds.draw != null ? ["draw"] : [])].map(side => {
            const odds   = match.odds[side];
            const imp    = match.impliedProb[side];
            const model  = match.modelProb?.[side];
            const edge   = match.value?.[side];
            const picked = alreadyPicked(side);
            const isVal  = edge != null && edge > 0;
            if (odds == null) return null;
            return (
              <button key={side}
                onClick={e => { e.stopPropagation(); if (side !== "draw") onPick(match, side); }}
                style={{
                  background: picked ? "#003322" : isVal ? "#0a1a0a" : "#141927",
                  border: `1px solid ${picked ? "#00aa55" : isVal ? "#1a4a2a" : "#1e2535"}`,
                  borderRadius: 7, padding: "8px 6px",
                  cursor: side === "draw" ? "default" : "pointer", textAlign: "center",
                  opacity: side === "draw" ? 0.7 : 1,
                }}>
                <div style={{ fontSize: 9, color: picked ? "#00ff88" : "#445", marginBottom: 2 }}>
                  {side === "home" ? "DOM" : side === "away" ? "VIS" : "NUL"}
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: picked ? "#00ff88" : "#ddd" }}>
                  {fmtAmerican(odds)}
                </div>
                <div style={{ fontSize: 9, color: "#445" }}>book {fmtPct(imp)}</div>
                {model != null && (
                  <div style={{ fontSize: 9, color: edgeColor(edge), marginTop: 2 }}>
                    mdl {fmtPct(model)} {edge >= 0 ? "▲" : "▼"}
                    {edge != null && <span style={{ marginLeft: 3 }}>({edge >= 0 ? "+" : ""}{fmtPct(edge)})</span>}
                  </div>
                )}
                {picked && <div style={{ fontSize: 8, color: "#00ff88", marginTop: 2 }}>✓ AJOUTÉ</div>}
              </button>
            );
          })}
        </div>
      </div>

      {expanded && (match.homeStats || match.awayStats) && (
        <div style={{ padding: "0 14px 12px", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <TeamStats stats={match.homeStats} label={`${match.homeTeam} (DOM)`} isHome={true} />
          <TeamStats stats={match.awayStats} label={`${match.awayTeam} (VIS)`} isHome={false} />
        </div>
      )}
      {expanded && !match.homeStats && !match.awayStats && (
        <div style={{ padding: "0 14px 12px", fontSize: 10, color: "#334" }}>
          Stats non disponibles — FOOTBALL_API_KEY requis
        </div>
      )}
    </div>
  );
}

// ─── ParlayCard ───────────────────────────────────────────────────────────────
export function ParlayCard({ parlay, index, stake, onLoad, onSave }) {
  const gain     = Math.round(stake * parlay.combinedDec - stake);
  const american = Math.round((parlay.combinedDec - 1) * 100);
  const evCol    = parlay.modelEV > 0.05 ? "#00ff88" : parlay.modelEV > 0 ? "#88ffcc" : "#ffcc44";
  return (
    <div style={{ background: "#080f0a", border: `2px solid ${parlay.modelEV > 0 ? "#1a4a2a" : "#1a2035"}`, borderRadius: 12, padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 10, color: "#445" }}>
          #{index + 1} · {parlay.legs.length} JAMBES
          {parlay.crossLeague && <span style={{ color: "#88aacc", marginLeft: 6 }}>MULTI-LIGUE</span>}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {parlay.avgEdge != null && (
            <span style={{ fontSize: 10, fontWeight: 700, color: edgeColor(parlay.avgEdge), background: edgeColor(parlay.avgEdge) + "22", padding: "2px 8px", borderRadius: 20 }}>
              edge {parlay.avgEdge >= 0 ? "+" : ""}{fmtPct(parlay.avgEdge)}
            </span>
          )}
          <span style={{ fontSize: 10, fontWeight: 700, color: evCol, background: evCol + "22", padding: "2px 8px", borderRadius: 20 }}>
            EV {parlay.modelEV >= 0 ? "+" : ""}{(parlay.modelEV * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {parlay.legs.map((leg, i) => {
        const conf = confidenceLabel(leg.modelProb || 0.4);
        return (
          <div key={i} style={{ background: "#0f1a0f", borderRadius: 8, padding: "8px 10px", marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#556" }}>{leg.matchup}</div>
                <div style={{ fontSize: 13, color: "#eee", fontWeight: 600, marginTop: 2 }}>{leg.team}</div>
                {leg.stats && (
                  <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9, color: "#445" }}>Rang <span style={{ color: "#88aacc" }}>#{leg.stats.rank}</span></span>
                    <span style={{ fontSize: 9, color: "#445" }}>PPG <span style={{ color: leg.stats.ppg >= 2 ? "#00ff88" : "#ffcc44" }}>{leg.stats.ppg}</span></span>
                    <span style={{ fontSize: 9, color: "#445" }}>Forme <FormPills form={leg.stats.form} /></span>
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
                <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#00cc66" }}>{fmtAmerican(leg.odds)}</div>
                {leg.modelProb != null && <div style={{ fontSize: 9, color: conf.color }}>{conf.label} {fmtPct(leg.modelProb)}</div>}
                {leg.edge != null && <div style={{ fontSize: 9, color: edgeColor(leg.edge) }}>{leg.edge >= 0 ? "+" : ""}{fmtPct(leg.edge)}</div>}
              </div>
            </div>
          </div>
        );
      })}

      <div style={{ background: "#0a1a0a", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <div>
          <div style={{ fontSize: 9, color: "#445" }}>COTE</div>
          <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color: "#fff" }}>{american >= 0 ? "+" : ""}{american}</div>
          {parlay.combinedModelProb != null && <div style={{ fontSize: 9, color: "#445", marginTop: 2 }}>Prob modèle: {fmtPct(parlay.combinedModelProb)}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#445" }}>GAIN POUR ${stake}</div>
          <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#00ff88" }}>${gain}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button onClick={() => onLoad(parlay)} style={{ flex: 1, background: "#0a1a2a", border: "1px solid #1a3a5a", color: "#88aacc", padding: "6px", borderRadius: 6, cursor: "pointer", fontSize: 10 }}>
          → Charger dans Builder
        </button>
        <button onClick={() => onSave(parlay)} style={{ flex: 1, background: "#0a1a0a", border: "1px solid #1a4a2a", color: "#00aa55", padding: "6px", borderRadius: 6, cursor: "pointer", fontSize: 10 }}>
          + Enregistrer
        </button>
      </div>
    </div>
  );
}

// ─── HistoryTab ───────────────────────────────────────────────────────────────
export function HistoryTab({ history, onUpdate, onClear }) {
  const wins   = history.filter(h => h.result === "win").length;
  const losses = history.filter(h => h.result === "loss").length;
  const totalStaked = history.reduce((s, h) => s + (h.stake || 0), 0);
  const totalWon    = history.filter(h => h.result === "win").reduce((s, h) => s + (h.payout || 0), 0);
  const net = totalWon - history.filter(h => h.result === "loss").reduce((s, h) => s + (h.stake || 0), 0);

  if (!history.length) return <div style={{ color: "#334", textAlign: "center", padding: "40px 0", fontSize: 12 }}>Aucun pari enregistré</div>;

  return (
    <div>
      <div style={{ background: "#0a0f1a", border: "1px solid #1a2035", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
          {[["✓ Gagnés", wins, "#00ff88"], ["✗ Perdus", losses, "#ff5555"], ["⏳ Attente", history.filter(h => h.result === "pending").length, "#ffcc44"]].map(([l, v, c]) => (
            <div key={l} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#445" }}>{l}</div>
              <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: c }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ borderTop: "1px solid #1a2035", paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
          <div><div style={{ fontSize: 9, color: "#445" }}>TOTAL MISÉ</div><div style={{ fontFamily: "monospace", color: "#ccd" }}>${totalStaked}</div></div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 9, color: "#445" }}>P&L NET</div><div style={{ fontFamily: "monospace", fontWeight: 700, color: net >= 0 ? "#00ff88" : "#ff5555" }}>{net >= 0 ? "+" : ""}${net.toFixed(2)}</div></div>
        </div>
      </div>
      <button onClick={onClear} style={{ width: "100%", background: "#1a0a0a", border: "1px solid #aa2222", color: "#ff6666", padding: 7, borderRadius: 6, cursor: "pointer", fontSize: 10, marginBottom: 12 }}>
        Effacer l'historique
      </button>
      {history.map(entry => (
        <div key={entry.id} style={{ background: "#0a0f1a", border: "1px solid #1a2035", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "#445" }}>{entry.date}</span>
            <span style={{ fontFamily: "monospace", fontSize: 12, color: "#fff" }}>{entry.american >= 0 ? "+" : ""}{entry.american}</span>
          </div>
          {(entry.legs || []).map((leg, i) => (
            <div key={i} style={{ fontSize: 11, color: "#667", marginBottom: 2 }}>
              {leg.team || leg.outcome} · {(leg.odds || leg.price) >= 0 ? "+" : ""}{Math.round(leg.odds || leg.price || 0)}
            </div>
          ))}
          <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#445" }}>Mise ${entry.stake} → <span style={{ color: "#00ff88" }}>${(entry.payout || 0).toFixed(0)}</span></span>
            <div style={{ display: "flex", gap: 4 }}>
              {["win", "loss", "pending"].map(r => (
                <button key={r} onClick={() => onUpdate(entry.id, r)} style={{
                  padding: "3px 8px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 700,
                  background: entry.result === r ? (r === "win" ? "#00ff88" : r === "loss" ? "#ff5555" : "#ffcc44") : "#1a2035",
                  color: entry.result === r ? "#000" : "#445",
                }}>{r === "win" ? "✓" : r === "loss" ? "✗" : "⏳"}</button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── BuilderTab ───────────────────────────────────────────────────────────────
export function BuilderTab({ picks, onRemove, stake, setStake }) {
  const [legSize, setLegSize] = useState(3);

  const parlays = useMemo(() => {
    if (picks.length < legSize) return [];
    return getCombinations(picks, legSize).map(legs => {
      const dec  = legs.reduce((a, p) => a * americanToDecimal(p.odds), 1);
      const win  = stake * dec - stake;
      const edges = legs.map(l => l.edge).filter(v => v != null);
      const mps   = legs.map(l => l.modelProb).filter(v => v != null);
      const avgEdge = edges.length ? edges.reduce((a,b)=>a+b,0)/edges.length : null;
      const combinedModelProb = mps.length === legs.length ? mps.reduce((a,b)=>a*b,1) : null;
      const modelEV = combinedModelProb ? combinedModelProb * dec - 1 : null;
      return { legs, dec, win, american: Math.round((dec-1)*100), avgEdge, combinedModelProb, modelEV };
    }).sort((a,b) => (b.avgEdge??-99)-(a.avgEdge??-99));
  }, [picks, legSize, stake]);

  if (picks.length === 0) return (
    <div style={{ color: "#334", textAlign: "center", padding: "40px 0", fontSize: 12 }}>
      Clique sur les cotes des matchs pour ajouter des picks
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: "#445", marginBottom: 6 }}>PICKS ({picks.length})</div>
        {picks.map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "#1a1f2e", borderRadius: 6, padding: "8px 10px", marginBottom: 5, borderLeft: "3px solid #00ff88" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: "#556" }}>{p.matchup}</div>
              <div style={{ fontSize: 13, color: "#eee", fontWeight: 600 }}>{p.team}</div>
              {p.stats && (
                <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                  <span style={{ fontSize: 9, color: "#445" }}>#{p.stats.rank}</span>
                  <span style={{ fontSize: 9, color: "#445" }}>PPG {p.stats.ppg}</span>
                  <FormPills form={p.stats.form} />
                </div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "monospace", fontSize: 14, color: "#00ff88" }}>{fmtAmerican(p.odds)}</div>
              {p.edge != null && <div style={{ fontSize: 9, color: edgeColor(p.edge) }}>{p.edge >= 0 ? "+" : ""}{fmtPct(p.edge)}</div>}
            </div>
            <button onClick={() => onRemove(i)} style={{ background: "none", border: "none", color: "#445", cursor: "pointer", fontSize: 18 }}>×</button>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 9, color: "#445", marginBottom: 4 }}>LEGS</div>
          <div style={{ display: "flex", gap: 4 }}>
            {[2, 3, 4, 5].map(n => (
              <button key={n} onClick={() => setLegSize(n)} style={{
                background: legSize === n ? "#00ff8822" : "#0f1320",
                border: `1px solid ${legSize === n ? "#00aa55" : "#1e2535"}`,
                color: legSize === n ? "#00ff88" : "#556",
                padding: "4px 10px", borderRadius: 4, cursor: