import { useState, useCallback, useEffect } from "react";
import ParlayOptimizer from "./ParlayOptimizer";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
const HISTORY_KEY = "parlayedge_history";

const LEAGUES = [
  { key: "soccer_epl",                label: "Premier League",   flag: "PL" },
  { key: "soccer_uefa_champs_league", label: "Champions League", flag: "CL" },
  { key: "soccer_spain_la_liga",      label: "La Liga",          flag: "ES" },
  { key: "soccer_germany_bundesliga", label: "Bundesliga",       flag: "DE" },
  { key: "soccer_italy_serie_a",      label: "Serie A",          flag: "IT" },
  { key: "soccer_france_ligue_one",   label: "Ligue 1",          flag: "FR1" },
  { key: "soccer_france_ligue_2",     label: "Ligue 2",          flag: "FR2" },
  { key: "soccer_france_ligue_nationale", label: "National",     flag: "FRN" },
  { key: "soccer_usa_mls",            label: "MLS",              flag: "US" },
];

function americanToDecimal(odds) {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}
function calcNoVigProbs(outcomes) {
  const raw = outcomes.map(o => 1 / americanToDecimal(o.price));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map(p => p / total);
}
function calcCombinedDecimal(legs) {
  return legs.reduce((acc, l) => acc * americanToDecimal(l.price), 1);
}
function fmtAmerican(odds) {
  return odds > 0 ? "+" + Math.round(odds) : "" + Math.round(odds);
}
function fmtPct(p) { return (p * 100).toFixed(1) + "%"; }
function evColor(ev) {
  if (ev > 0.05) return "#00ff88";
  if (ev > 0) return "#88ffcc";
  if (ev > -0.05) return "#ffcc44";
  return "#ff5555";
}
function edgeColor(edge) {
  if (edge > 0.04) return "#00ff88";
  if (edge > 0.01) return "#88ffcc";
  if (edge > -0.02) return "#ffcc44";
  return "#ff5555";
}
function confidenceLabel(prob) {
  if (prob >= 0.68) return { label: "TRÈS SÛR", color: "#00ff88" };
  if (prob >= 0.58) return { label: "SÛR",      color: "#88ffcc" };
  if (prob >= 0.50) return { label: "PROBABLE", color: "#ffcc44" };
  return                    { label: "RISQUÉ",   color: "#ff5555" };
}

function normalizeName(name) {
  return name.toLowerCase()
    .replace(/\b(fc|cf|sc|ac|as|rc|ss|afc|utd|united|city|town|sporting|athletic|real|club|calcio|inter|atletico)\b/g, "")
    .replace(/^(1\.|vfb|vfl|rb|bvb|sv|fsv|tsg|tsv|sc|fc|ac|as|ss|rc)\s+/g, "")
    .replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}
function teamMatchScore(nameA, nameB) {
  const a = normalizeName(nameA), b = normalizeName(nameB);
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const wA = a.split(" ").filter(w => w.length > 2);
  const wB = b.split(" ").filter(w => w.length > 2);
  if (!wA.length || !wB.length) return 0;
  return wA.filter(w => wB.includes(w)).length / Math.max(wA.length, wB.length);
}
function findTeamInStandings(teamName, standings) {
  let best = null, bestScore = 0;
  for (const [name, stats] of Object.entries(standings)) {
    const score = teamMatchScore(teamName, name);
    if (score > bestScore) { bestScore = score; best = { stats, matchedName: name, score }; }
  }
  return bestScore >= 0.5 ? best : null;
}

function calcModelProbsForGame(homeTeam, awayTeam, standings) {
  const hM = findTeamInStandings(homeTeam, standings);
  const aM = findTeamInStandings(awayTeam, standings);
  if (!hM || !aM) return null;
  const h = hM.stats, a = aM.stats;
  const maxPts = Math.max(h.played, a.played, 1) * 3;
  function formScore(f) {
    if (!f) return 0.45;
    const last5 = f.slice(-5); let s = 0, c = 0;
    for (const ch of last5) { if (ch === "W") s += 1; else if (ch === "D") s += 0.5; c++; }
    return c > 0 ? s / c : 0.45;
  }
  const homeXG = (h.homePlayed > 0 ? h.homeGoalsFor / h.homePlayed : 1.4)
    * ((a.awayPlayed > 0 ? a.awayGoalsAgainst / a.awayPlayed : 1.6) / 1.4);
  const awayXG = (a.awayPlayed > 0 ? a.awayGoalsFor / a.awayPlayed : 1.0)
    * ((h.homePlayed > 0 ? h.homeGoalsAgainst / h.homePlayed : 1.2) / 1.2);
  const hS = (h.points / maxPts * 0.40) + (formScore(h.form) * 0.35) + (Math.min(homeXG, 3) / 3 * 0.25);
  const aS = (a.points / maxPts * 0.40) + (formScore(a.form) * 0.35) + (Math.min(awayXG, 3) / 3 * 0.25);
  const tot = hS + aS;
  const rawH = (hS / tot) * 0.73 + 0.06, rawA = (aS / tot) * 0.73, rawD = 0.27;
  const rawTot = rawH + rawA + rawD;
  return {
    home: Math.max(0.10, Math.min(0.75, rawH / rawTot)),
    away: Math.max(0.10, Math.min(0.65, rawA / rawTot)),
    draw: Math.max(0.15, Math.min(0.35, rawD / rawTot)),
    matchConfidence: Math.min(hM.score, aM.score),
  };
}

function getCombinations(arr, k) {
  if (k === 1) return arr.map(x => [x]);
  const result = [];
  for (let i = 0; i <= arr.length - k; i++) {
    getCombinations(arr.slice(i + 1), k - 1).forEach(rest => result.push([arr[i], ...rest]));
  }
  return result;
}

function buildAllLegs(games, standingsMap) {
  const allLegs = [];
  games.forEach(game => {
    const market = game.bookmakers?.[0]?.markets?.[0];
    if (!market) return;
    let modelProbs = null;
    for (const [, { standings }] of Object.entries(standingsMap)) {
      const mp = calcModelProbsForGame(game.home_team, game.away_team, standings);
      if (mp && mp.matchConfidence >= 0.6) { modelProbs = mp; break; }
    }
    const nvps = calcNoVigProbs(market.outcomes);
    market.outcomes.forEach((outcome, i) => {
      if (outcome.price < -200) return;
      const bookProb = nvps[i];
      let modelProb = bookProb, edge = 0, hasModel = false;
      if (modelProbs) {
        modelProb = outcome.name === game.home_team ? modelProbs.home
          : outcome.name === game.away_team ? modelProbs.away : modelProbs.draw;
        edge = modelProb - bookProb;
        hasModel = true;
      }
      allLegs.push({
        gameId: game.id, sport_key: game.sport_key,
        gameLabel: game.home_team + " vs " + game.away_team,
        outcome: outcome.name, price: outcome.price,
        noVigProb: bookProb, modelProb, edge, hasModel,
      });
    });
  });
  return allLegs;
}

function buildSafeParlays(games, standingsMap, topN = 8) {
  const safeLegs = buildAllLegs(games, standingsMap).filter(leg =>
    leg.hasModel && leg.modelProb >= 0.55 && leg.edge > 0 &&
    leg.price >= -200 && leg.price <= 250
  );
  const results = [];
  getCombinations(safeLegs, 2).forEach(combo => {
    const ids = combo.map(l => l.gameId);
    if (new Set(ids).size !== ids.length) return;
    const combinedDec = calcCombinedDecimal(combo);
    const modelProb = combo.reduce((acc, l) => acc * l.modelProb, 1);
    const modelEV = modelProb * combinedDec - 1;
    const avgEdge = combo.reduce((s, l) => s + l.edge, 0) / 2;
    const americanOdds = (combinedDec - 1) * 100;
    if (modelProb < 0.28 || modelProb > 0.72) return;
    if (americanOdds < 40) return;
    if (modelEV <= 0) return;
    const crossLeague = combo[0].sport_key !== combo[1].sport_key;
    const minLegProb = Math.min(...combo.map(l => l.modelProb));
    const valueScore = modelEV * modelProb * minLegProb * (1 + avgEdge) * (crossLeague ? 1.2 : 1.0);
    results.push({ legs: combo, combinedDec, modelProb, modelEV, avgEdge, americanOdds, valueScore, crossLeague, isSafe: true });
  });
  return results.sort((a, b) => b.valueScore - a.valueScore).slice(0, topN);
}

function buildSuggestions(games, standingsMap, topN = 10) {
  const allLegs = buildAllLegs(games, standingsMap);
  const results = [];
  [2, 3].forEach(size => {
    getCombinations(allLegs, size).forEach(combo => {
      const ids = combo.map(l => l.gameId);
      if (new Set(ids).size !== ids.length) return;
      const combinedDec = calcCombinedDecimal(combo);
      const modelProb = combo.reduce((acc, l) => acc * l.modelProb, 1);
      const bookProb  = combo.reduce((acc, l) => acc * l.noVigProb, 1);
      const modelEV   = modelProb * combinedDec - 1;
      const avgEdge   = combo.reduce((s, l) => s + l.edge, 0) / combo.length;
      if (modelProb < 0.12 || modelProb > 0.55) return;
      if ((combinedDec - 1) * 100 < 120) return;
      if (modelEV > 0.60 || modelEV < -0.20) return;
      const crossLeague = new Set(combo.map(l => l.sport_key)).size > 1;
      const valueScore = modelEV * Math.sqrt(modelProb) * (1 + Math.max(0, avgEdge)) * (crossLeague ? 1.15 : 1.0);
      results.push({ legs: combo, combinedDec, modelProb, bookProb, modelEV, avgEdge, hasModel: combo.some(l => l.hasModel), crossLeague, valueScore });
    });
  });
  return results.sort((a, b) => b.valueScore - a.valueScore).slice(0, topN);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LegRow({ leg, onRemove }) {
  const conf = confidenceLabel(leg.modelProb);
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", background:"#1a1f2e", borderRadius:6, borderLeft:"3px solid #00ff88", marginBottom:6 }}>
      <div style={{ flex:1, marginRight:8 }}>
        <div style={{ fontSize:10, color:"#556", marginBottom:2 }}>{leg.gameLabel}</div>
        <div style={{ fontSize:13, color:"#eee", fontWeight:600 }}>{leg.outcome}</div>
        <div style={{ fontSize:10, marginTop:2, display:"flex", gap:8, flexWrap:"wrap" }}>
          <span style={{ color:"#445" }}>book {fmtPct(leg.noVigProb)}</span>
          {leg.hasModel && (
            <>
              <span style={{ color: leg.edge > 0.02 ? "#00ff88" : leg.edge < -0.02 ? "#ff6666" : "#778" }}>
                mdl {fmtPct(leg.modelProb)} ({leg.edge >= 0 ? "+" : ""}{fmtPct(leg.edge)})
              </span>
              <span style={{ color: conf.color, fontSize:9 }}>{conf.label}</span>
            </>
          )}
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ color:"#00ff88", fontFamily:"monospace", fontSize:15, fontWeight:700 }}>{fmtAmerican(leg.price)}</span>
        <button onClick={() => onRemove(leg)} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:20, lineHeight:1, padding:0 }}>×</button>
      </div>
    </div>
  );
}

function GameCard({ game, selectedLegs, onToggleLeg, standingsMap }) {
  const market = game.bookmakers?.[0]?.markets?.[0];
  if (!market) return null;
  const nvps = calcNoVigProbs(market.outcomes);
  const date = new Date(game.commence_time);
  const dateStr = date.toLocaleDateString("fr-CA", { month:"short", day:"numeric" });
  const timeStr = date.toLocaleTimeString("fr-CA", { hour:"2-digit", minute:"2-digit" });
  let modelProbs = null;
  for (const [, { standings }] of Object.entries(standingsMap)) {
    const mp = calcModelProbsForGame(game.home_team, game.away_team, standings);
    if (mp && mp.matchConfidence >= 0.6) { modelProbs = mp; break; }
  }
  function isSelected(name) { return selectedLegs.some(l => l.gameId === game.id && l.outcome === name); }
  function outcomeLabel(name) {
    if (name === game.home_team) return "Dom.";
    if (name === game.away_team) return "Vis.";
    return "Nul";
  }
  function getModelProb(name) {
    if (!modelProbs) return null;
    if (name === game.home_team) return modelProbs.home;
    if (name === game.away_team) return modelProbs.away;
    return modelProbs.draw;
  }
  return (
    <div style={{ background:"#0f1320", border:"1px solid #1e2535", borderRadius:10, padding:"12px 14px", marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
        <span style={{ fontSize:10, color:"#445" }}>{dateStr} - {timeStr}</span>
        <span style={{ fontSize:10, color: modelProbs ? "#00aa55" : "#334" }}>{modelProbs ? "✓ modèle" : game.sport_title}</span>
      </div>
      <div style={{ fontSize:12, color:"#aab", marginBottom:10, textAlign:"center", fontWeight:600 }}>
        {game.home_team} vs {game.away_team}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5 }}>
        {market.outcomes.map((outcome, idx) => {
          const sel = isSelected(outcome.name);
          const tooHeavy = outcome.price < -200;
          const mp = getModelProb(outcome.name);
          const edge = mp ? mp - nvps[idx] : 0;
          const conf = mp ? confidenceLabel(mp) : null;
          return (
            <button key={outcome.name}
              onClick={() => !tooHeavy && onToggleLeg(game, outcome, nvps[idx], mp || nvps[idx], edge, !!modelProbs)}
              style={{ background:sel?"#003322":tooHeavy?"#0a0c14":"#141927", border:"1px solid "+(sel?"#00aa55":tooHeavy?"#111":edge>0.03?"#1a4a2a":"#1e2535"), borderRadius:7, padding:"8px 4px", cursor:tooHeavy?"not-allowed":"pointer", textAlign:"center", opacity:tooHeavy?0.4:1 }}>
              <div style={{ fontSize:10, color:sel?"#00ff88":"#556", marginBottom:2 }}>{outcomeLabel(outcome.name)}</div>
              <div style={{ fontFamily:"monospace", fontSize:15, fontWeight:700, color:sel?"#00ff88":tooHeavy?"#444":"#ddd" }}>{fmtAmerican(outcome.price)}</div>
              <div style={{ fontSize:9, color:"#445" }}>book {fmtPct(nvps[idx])}</div>
              {mp && (
                <>
                  <div style={{ fontSize:9, color: edge > 0.03 ? "#00ff88" : edge < -0.03 ? "#ff6666" : "#667", marginTop:1 }}>
                    mdl {fmtPct(mp)} {edge >= 0 ? "▲" : "▼"}
                  </div>
                  <div style={{ fontSize:8, color: conf.color, marginTop:1 }}>{conf.label}</div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SuggestionCard({ parlay, index, onLoad }) {
  const evc = evColor(parlay.modelEV);
  const ec  = edgeColor(parlay.avgEdge);
  const shortLabel = label => label.split(" vs ").map(t => t.split(" ").slice(-1)[0]).join(" v ");
  const americanOdds = Math.round((parlay.combinedDec - 1) * 100);
  return (
    <div onClick={() => onLoad(parlay)} style={{ background:"#0a0f1a", border:"1px solid "+(parlay.modelEV>0?"#1a3a2a":"#1a1e2e"), borderRadius:10, padding:"12px 14px", marginBottom:8, cursor:"pointer" }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6, flexWrap:"wrap", gap:4 }}>
        <span style={{ fontSize:10, color:"#445" }}>
          #{index+1} · {parlay.legs.length} JAMBES
          {parlay.crossLeague && <span style={{ color:"#88aacc", marginLeft:6 }}>CROSS-LIGUE</span>}
        </span>
        <div style={{ display:"flex", gap:5 }}>
          <span style={{ fontSize:10, fontWeight:700, color:ec, background:ec+"22", padding:"2px 6px", borderRadius:20 }}>
            edge {parlay.avgEdge>=0?"+":""}{fmtPct(parlay.avgEdge)}
          </span>
          <span style={{ fontSize:10, fontWeight:700, color:evc, background:evc+"22", padding:"2px 6px", borderRadius:20 }}>
            EV {parlay.modelEV>=0?"+":""}{(parlay.modelEV*100).toFixed(1)}%
          </span>
        </div>
      </div>
      {parlay.legs.map((leg, i) => {
        const conf = confidenceLabel(leg.modelProb);
        return (
          <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"4px 0", borderBottom:i<parlay.legs.length-1?"1px solid #111":"none" }}>
            <div>
              <span style={{ fontSize:11, color:"#667" }}>{leg.outcome.split(" ").slice(-1)[0]} · {shortLabel(leg.gameLabel)}</span>
              {leg.hasModel && <span style={{ fontSize:9, color: conf.color, marginLeft:6 }}>{conf.label}</span>}
            </div>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              {leg.hasModel && <span style={{ fontSize:9, color: leg.edge > 0.02 ? "#00ff88" : leg.edge < -0.02 ? "#ff6666" : "#556" }}>{leg.edge>=0?"+":""}{fmtPct(leg.edge)}</span>}
              <span style={{ fontSize:11, color:"#00cc66", fontFamily:"monospace" }}>{fmtAmerican(leg.price)}</span>
            </div>
          </div>
        );
      })}
      <div style={{ marginTop:8, display:"flex", gap:12, flexWrap:"wrap" }}>
        <span style={{ fontSize:10, color:"#334" }}>Cote: <span style={{ color:"#fff", fontFamily:"monospace" }}>{fmtAmerican(americanOdds)}</span></span>
        <span style={{ fontSize:10, color:"#334" }}>Prob: <span style={{ color:"#88aacc" }}>{fmtPct(parlay.modelProb)}</span></span>
        <span style={{ fontSize:10, color:"#334" }}>{parlay.combinedDec.toFixed(2)}x</span>
      </div>
    </div>
  );
}

function SafeCard({ parlay, index, onLoad, stake }) {
  const gain = Math.round(stake * parlay.combinedDec - stake);
  const americanOdds = Math.round((parlay.combinedDec - 1) * 100);
  return (
    <div onClick={() => onLoad(parlay)} style={{ background:"#080f0a", border:"2px solid #1a4a2a", borderRadius:12, padding:"14px", marginBottom:10, cursor:"pointer" }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
        <span style={{ fontSize:10, color:"#445" }}>
          #{index+1} · 2 JAMBES
          {parlay.crossLeague && <span style={{ color:"#88aacc", marginLeft:6 }}>CROSS-LIGUE</span>}
        </span>
        <span style={{ fontSize:11, fontWeight:700, color:"#00ff88", background:"#00ff8822", padding:"2px 8px", borderRadius:20 }}>
          EV +{(parlay.modelEV*100).toFixed(1)}%
        </span>
      </div>
      {parlay.legs.map((leg, i) => {
        const conf = confidenceLabel(leg.modelProb);
        return (
          <div key={i} style={{ background:"#0f1a0f", borderRadius:8, padding:"8px 10px", marginBottom:6 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:10, color:"#556" }}>{leg.gameLabel}</div>
                <div style={{ fontSize:13, color:"#eee", fontWeight:600, marginTop:2 }}>{leg.outcome}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:"monospace", fontSize:16, fontWeight:700, color:"#00cc66" }}>{fmtAmerican(leg.price)}</div>
                <div style={{ fontSize:9, color: conf.color }}>{conf.label}</div>
              </div>
            </div>
            <div style={{ marginTop:6, display:"flex", gap:12 }}>
              <span style={{ fontSize:10, color:"#445" }}>Modèle: <span style={{ color:"#88aacc" }}>{fmtPct(leg.modelProb)}</span></span>
              <span style={{ fontSize:10, color:"#445" }}>Edge: <span style={{ color:"#00ff88" }}>+{fmtPct(leg.edge)}</span></span>
            </div>
          </div>
        );
      })}
      <div style={{ marginTop:8, background:"#0a1a0a", borderRadius:8, padding:"10px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:9, color:"#445" }}>COTE COMBINÉE</div>
          <div style={{ fontFamily:"monospace", fontSize:17, fontWeight:700, color:"#fff" }}>{fmtAmerican(americanOdds)}</div>
          <div style={{ fontSize:9, color:"#445", marginTop:2 }}>Prob victoire: {fmtPct(parlay.modelProb)}</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:9, color:"#445" }}>GAIN POUR ${stake}</div>
          <div style={{ fontFamily:"monospace", fontSize:22, fontWeight:700, color:"#00ff88" }}>${gain}</div>
        </div>
      </div>
    </div>
  );
}

function HistoryTab({ history, onDelete, onClear }) {
  const wins    = history.filter(h => h.result === "win").length;
  const losses  = history.filter(h => h.result === "loss").length;
  const pending = history.filter(h => h.result === "pending").length;
  const totalStaked = history.reduce((s, h) => s + (h.stake || 0), 0);
  const totalWon    = history.filter(h => h.result === "win").reduce((s, h) => s + (h.gain || 0), 0);
  const totalLost   = history.filter(h => h.result === "loss").reduce((s, h) => s + (h.stake || 0), 0);
  const netPnl      = totalWon - totalLost;

  if (history.length === 0) {
    return <div style={{ color:"#334", fontSize:12, padding:"24px 0", textAlign:"center" }}>Aucun pari enregistré</div>