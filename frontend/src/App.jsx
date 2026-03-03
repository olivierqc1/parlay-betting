import { useState, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

const LEAGUES = [
  { key: "soccer_epl",                label: "Premier League",   flag: "PL" },
  { key: "soccer_uefa_champs_league", label: "Champions League", flag: "CL" },
  { key: "soccer_spain_la_liga",      label: "La Liga",          flag: "ES" },
  { key: "soccer_germany_bundesliga", label: "Bundesliga",       flag: "DE" },
  { key: "soccer_italy_serie_a",      label: "Serie A",          flag: "IT" },
  { key: "soccer_france_ligue_one",   label: "Ligue 1",          flag: "FR" },
  { key: "soccer_usa_mls",            label: "MLS",              flag: "US" },
];

function americanToDecimal(odds) {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}
function calcNoVigProbs(outcomes) {
  const raw = outcomes.map((o) => 1 / americanToDecimal(o.price));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((p) => p / total);
}
function calcCombinedDecimal(legs) {
  return legs.reduce((acc, l) => acc * americanToDecimal(l.price), 1);
}
function fmtAmerican(odds) {
  return odds > 0 ? "+" + Math.round(odds) : "" + Math.round(odds);
}
function fmtPct(p) {
  return (p * 100).toFixed(1) + "%";
}
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

// Normalisation noms équipes côté frontend (mirror du backend)
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|as|rc|ss|afc|utd|united|city|town|sporting|athletic|real|club|calcio|inter|atletico)\b/g, "")
    .replace(/^(1\.|vfb|vfl|rb|bvb|sv|fsv|tsg|tsv|sc|fc|ac|as|ss|rc)\s+/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamMatchScore(nameA, nameB) {
  const a = normalizeName(nameA);
  const b = normalizeName(nameB);
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const wordsA = a.split(" ").filter(w => w.length > 2);
  const wordsB = b.split(" ").filter(w => w.length > 2);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const common = wordsA.filter(w => wordsB.includes(w));
  return common.length / Math.max(wordsA.length, wordsB.length);
}

function findTeamInStandings(teamName, standings) {
  let bestMatch = null;
  let bestScore = 0;
  for (const [name, stats] of Object.entries(standings)) {
    const score = teamMatchScore(teamName, name);
    if (score > bestScore) { bestScore = score; bestMatch = { stats, matchedName: name, score }; }
  }
  return bestScore >= 0.5 ? bestMatch : null;
}

function calcModelProbsForGame(homeTeam, awayTeam, standings) {
  const hMatch = findTeamInStandings(homeTeam, standings);
  const aMatch = findTeamInStandings(awayTeam, standings);
  if (!hMatch || !aMatch) return null;

  const h = hMatch.stats;
  const a = aMatch.stats;

  const maxPts = Math.max(h.played, a.played, 1) * 3;
  const homePtsPct = h.points / maxPts;
  const awayPtsPct = a.points / maxPts;

  function formScore(formStr) {
    if (!formStr) return 0.45;
    const last5 = formStr.slice(-5);
    let score = 0, count = 0;
    for (const c of last5) {
      if (c === "W") score += 1;
      else if (c === "D") score += 0.5;
      count++;
    }
    return count > 0 ? score / count : 0.45;
  }

  const homeXG = (h.homePlayed > 0 ? h.homeGoalsFor / h.homePlayed : 1.4) *
    ((a.awayPlayed > 0 ? a.awayGoalsAgainst / a.awayPlayed : 1.6) / 1.4);
  const awayXG = (a.awayPlayed > 0 ? a.awayGoalsFor / a.awayPlayed : 1.0) *
    ((h.homePlayed > 0 ? h.homeGoalsAgainst / h.homePlayed : 1.2) / 1.2);

  const homeStr = (homePtsPct * 0.40) + (formScore(h.form) * 0.35) + (Math.min(homeXG, 3) / 3 * 0.25);
  const awayStr = (awayPtsPct * 0.40) + (formScore(a.form) * 0.35) + (Math.min(awayXG, 3) / 3 * 0.25);
  const total = homeStr + awayStr;

  const rawHome = (homeStr / total) * 0.73 + 0.06;
  const rawAway = (awayStr / total) * 0.73;
  const rawDraw = 0.27;
  const rawTotal = rawHome + rawAway + rawDraw;

  return {
    home: Math.max(0.10, Math.min(0.75, rawHome / rawTotal)),
    away: Math.max(0.10, Math.min(0.65, rawAway / rawTotal)),
    draw: Math.max(0.15, Math.min(0.35, rawDraw / rawTotal)),
    homeMatched: hMatch.matchedName,
    awayMatched: aMatch.matchedName,
    matchConfidence: Math.min(hMatch.score, aMatch.score),
  };
}

function getCombinations(arr, k) {
  if (k === 1) return arr.map((x) => [x]);
  const result = [];
  for (let i = 0; i <= arr.length - k; i++) {
    getCombinations(arr.slice(i + 1), k - 1).forEach((rest) =>
      result.push([arr[i], ...rest])
    );
  }
  return result;
}

function buildSuggestions(games, standingsMap, topN = 10) {
  const allLegs = [];

  games.forEach((game) => {
    const market = game.bookmakers?.[0]?.markets?.[0];
    if (!market) return;

    let modelProbs = null;
    for (const [, { standings }] of Object.entries(standingsMap)) {
      const mp = calcModelProbsForGame(game.home_team, game.away_team, standings);
      // Seuil de confiance: accepter seulement si bon matching
      if (mp && mp.matchConfidence >= 0.6) { modelProbs = mp; break; }
    }

    const nvps = calcNoVigProbs(market.outcomes);

    market.outcomes.forEach((outcome, i) => {
      if (outcome.price < -200) return;
      const bookProb = nvps[i];
      let modelProb = bookProb;
      let edge = 0;
      let hasModel = false;

      if (modelProbs) {
        const isHome = outcome.name === game.home_team;
        const isAway = outcome.name === game.away_team;
        if (isHome) modelProb = modelProbs.home;
        else if (isAway) modelProb = modelProbs.away;
        else modelProb = modelProbs.draw;
        edge = modelProb - bookProb;
        hasModel = true;
      }

      allLegs.push({
        gameId: game.id,
        gameLabel: game.home_team + " vs " + game.away_team,
        outcome: outcome.name,
        price: outcome.price,
        noVigProb: bookProb,
        modelProb,
        edge,
        hasModel,
      });
    });
  });

  const results = [];
  [2, 3].forEach((size) => {
    getCombinations(allLegs, size).forEach((combo) => {
      const ids = combo.map((l) => l.gameId);
      if (new Set(ids).size !== ids.length) return;

      const combinedDec = calcCombinedDecimal(combo);
      const modelProb = combo.reduce((acc, l) => acc * l.modelProb, 1);
      const bookProb = combo.reduce((acc, l) => acc * l.noVigProb, 1);
      const modelEV = modelProb * combinedDec - 1;
      const avgEdge = combo.reduce((s, l) => s + l.edge, 0) / combo.length;
      const hasModel = combo.some(l => l.hasModel);

      // Filtres stricts
      if (modelProb < 0.12 || modelProb > 0.55) return;
      const americanOdds = (combinedDec - 1) * 100;
      if (americanOdds < 120) return;
      // EV modèle doit être raisonnable - max +60% pour éviter les faux positifs
      if (modelEV > 0.60 || modelEV < -0.20) return;

      const valueScore = modelEV * Math.sqrt(modelProb) * (1 + Math.max(0, avgEdge));
      results.push({ legs: combo, combinedDec, modelProb, bookProb, modelEV, avgEdge, hasModel, valueScore });
    });
  });

  return results.sort((a, b) => b.valueScore - a.valueScore).slice(0, topN);
}

function LegRow({ leg, onRemove }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", background:"#1a1f2e", borderRadius:6, borderLeft:"3px solid #00ff88", marginBottom:6 }}>
      <div style={{ flex:1, marginRight:8 }}>
        <div style={{ fontSize:10, color:"#556", marginBottom:2 }}>{leg.gameLabel}</div>
        <div style={{ fontSize:13, color:"#eee", fontWeight:600 }}>{leg.outcome}</div>
        <div style={{ fontSize:10, color:"#445", marginTop:1 }}>
          book {fmtPct(leg.noVigProb)}
          {leg.hasModel && (
            <span style={{ color: leg.edge > 0.02 ? "#00ff88" : leg.edge < -0.02 ? "#ff6666" : "#778", marginLeft:8 }}>
              mdl {fmtPct(leg.modelProb)} ({leg.edge >= 0 ? "+" : ""}{fmtPct(leg.edge)})
            </span>
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

  function isSelected(name) {
    return selectedLegs.some((l) => l.gameId === game.id && l.outcome === name);
  }
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
        <span style={{ fontSize:10, color: modelProbs ? "#00aa55" : "#334" }}>
          {modelProbs ? "✓ modèle" : game.sport_title}
        </span>
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
          return (
            <button key={outcome.name}
              onClick={() => !tooHeavy && onToggleLeg(game, outcome, nvps[idx], mp || nvps[idx], edge, !!modelProbs)}
              style={{ background:sel?"#003322":tooHeavy?"#0a0c14":"#141927", border:"1px solid "+(sel?"#00aa55":tooHeavy?"#111":edge>0.03?"#1a4a2a":"#1e2535"), borderRadius:7, padding:"8px 4px", cursor:tooHeavy?"not-allowed":"pointer", textAlign:"center", opacity:tooHeavy?0.4:1 }}>
              <div style={{ fontSize:10, color:sel?"#00ff88":"#556", marginBottom:2 }}>{outcomeLabel(outcome.name)}</div>
              <div style={{ fontFamily:"monospace", fontSize:15, fontWeight:700, color:sel?"#00ff88":tooHeavy?"#444":"#ddd" }}>{fmtAmerican(outcome.price)}</div>
              <div style={{ fontSize:9, color:"#445" }}>book {fmtPct(nvps[idx])}</div>
              {mp && (
                <div style={{ fontSize:9, color: edge > 0.03 ? "#00ff88" : edge < -0.03 ? "#ff6666" : "#667", marginTop:1 }}>
                  mdl {fmtPct(mp)} {edge >= 0 ? "▲" : "▼"}
                </div>
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
  const ec = edgeColor(parlay.avgEdge);
  const shortLabel = (label) => label.split(" vs ").map((t) => t.split(" ").slice(-1)[0]).join(" v ");
  const americanOdds = Math.round((parlay.combinedDec - 1) * 100);
  return (
    <div onClick={() => onLoad(parlay)} style={{ background:"#0a0f1a", border:"1px solid "+(parlay.modelEV>0?"#1a3a2a":"#1a1e2e"), borderRadius:10, padding:"12px 14px", marginBottom:8, cursor:"pointer" }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6, flexWrap:"wrap", gap:4 }}>
        <span style={{ fontSize:10, color:"#445" }}>#{index+1} · {parlay.legs.length} JAMBES {parlay.hasModel?"✓":""}</span>
        <div style={{ display:"flex", gap:5 }}>
          {parlay.hasModel && (
            <span style={{ fontSize:10, fontWeight:700, color:ec, background:ec+"22", padding:"2px 6px", borderRadius:20 }}>
              edge {parlay.avgEdge>=0?"+":""}{fmtPct(parlay.avgEdge)}
            </span>
          )}
          <span style={{ fontSize:10, fontWeight:700, color:evc, background:evc+"22", padding:"2px 6px", borderRadius:20 }}>
            EV {parlay.modelEV>=0?"+":""}{(parlay.modelEV*100).toFixed(1)}%
          </span>
        </div>
      </div>
      {parlay.legs.map((leg, i) => (
        <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:i<parlay.legs.length-1?"1px solid #111":"none" }}>
          <span style={{ fontSize:11, color:"#667" }}>{leg.outcome.split(" ").slice(-1)[0]} · {shortLabel(leg.gameLabel)}</span>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            {leg.hasModel && <span style={{ fontSize:9, color: leg.edge > 0.02 ? "#00ff88" : leg.edge < -0.02 ? "#ff6666" : "#556" }}>{leg.edge>=0?"+":""}{fmtPct(leg.edge)}</span>}
            <span style={{ fontSize:11, color:"#00cc66", fontFamily:"monospace" }}>{fmtAmerican(leg.price)}</span>
          </div>
        </div>
      ))}
      <div style={{ marginTop:8, display:"flex", gap:12, flexWrap:"wrap" }}>
        <span style={{ fontSize:10, color:"#334" }}>Cote: <span style={{ color:"#fff", fontFamily:"monospace" }}>{fmtAmerican(americanOdds)}</span></span>
        <span style={{ fontSize:10, color:"#334" }}>Prob: <span style={{ color:"#88aacc" }}>{fmtPct(parlay.modelProb)}</span></span>
        <span style={{ fontSize:10, color:"#334" }}>{parlay.combinedDec.toFixed(2)}x</span>
      </div>
    </div>
  );
}

export default function App() {
  const [selectedLeagues, setSelectedLeagues] = useState(["soccer_epl", "soccer_uefa_champs_league"]);
  const [games, setGames] = useState([]);
  const [standingsMap, setStandingsMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(null);
  const [selectedLegs, setSelectedLegs] = useState([]);
  const [stake, setStake] = useState(100);
  const [suggestions, setSuggestions] = useState([]);
  const [activeTab, setActiveTab] = useState("builder");

  const fetchOdds = useCallback(async () => {
    if (selectedLeagues.length === 0) return;
    setLoading(true); setError(""); setGames([]); setSuggestions([]);
    try {
      const all = [];
      for (const sport of selectedLeagues) {
        const res = await fetch(API_BASE + "/api/odds?sport=" + sport);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Erreur " + res.status);
        if (json.meta?.remainingRequests != null) setRemaining(json.meta.remainingRequests);
        all.push(...(json.data || []).filter((g) => g.bookmakers?.length > 0));
      }
      all.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
      setGames(all);

      // Fetch standings en parallèle
      setModelLoading(true);
      const newStandings = {};
      await Promise.all(selectedLeagues.map(async (sport) => {
        try {
          const res = await fetch(API_BASE + "/api/model/" + sport);
          if (res.ok) {
            const json = await res.json();
            newStandings[sport] = { standings: json.standings, totalTeams: json.totalTeams };
          }
        } catch (e) {
          console.warn("Model fetch failed for", sport, e.message);
        }
      }));
      setStandingsMap(newStandings);
      setModelLoading(false);
      if (all.length > 0) setSuggestions(buildSuggestions(all, newStandings));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedLeagues]);

  function toggleLeague(key) {
    setSelectedLeagues((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  }

  function handleToggleLeg(game, outcome, noVigProb, modelProb, edge, hasModel) {
    setSelectedLegs((prev) => {
      const already = prev.find((l) => l.gameId === game.id && l.outcome === outcome.name);
      if (already) return prev.filter((l) => !(l.gameId === game.id && l.outcome === outcome.name));
      return [...prev.filter((l) => l.gameId !== game.id), {
        gameId: game.id,
        gameLabel: game.home_team + " vs " + game.away_team,
        outcome: outcome.name,
        price: outcome.price,
        noVigProb,
        modelProb: modelProb || noVigProb,
        edge: edge || 0,
        hasModel: hasModel || false,
      }];
    });
  }

  function removeLeg(leg) {
    setSelectedLegs((prev) => prev.filter((l) => !(l.gameId === leg.gameId && l.outcome === leg.outcome)));
  }

  function loadSuggestion(parlay) {
    setSelectedLegs(parlay.legs.map((l) => ({ ...l })));
    setActiveTab("builder");
  }

  const hasLegs = selectedLegs.length >= 2;
  const combinedDec = hasLegs ? selectedLegs.reduce((acc, l) => acc * americanToDecimal(l.price), 1) : 1;
  const modelProb = hasLegs ? selectedLegs.reduce((acc, l) => acc * l.modelProb, 1) : 1;
  const bookProb = hasLegs ? selectedLegs.reduce((acc, l) => acc * l.noVigProb, 1) : 1;
  const modelEV = hasLegs ? modelProb * combinedDec - 1 : 0;
  const potentialWin = stake * combinedDec - stake;
  const evc = evColor(modelEV);
  const avgEdge = hasLegs ? selectedLegs.reduce((s, l) => s + l.edge, 0) / selectedLegs.length : 0;

  return (
    <div style={{ minHeight:"100vh", background:"#070b14", color:"#ccd", fontFamily:"'IBM Plex Mono','Courier New',monospace", display:"flex", flexDirection:"column" }}>
      <header style={{ background:"#0a0f1c", borderBottom:"1px solid #1a2035", padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:"#00ff88", letterSpacing:2 }}>PARLAY<span style={{ color:"#fff" }}>EDGE</span></div>
          <div style={{ fontSize:10, color:"#445", letterSpacing:1 }}>
            {modelLoading
              ? <span style={{ color:"#ffcc44" }}>chargement modèle...</span>
              : Object.keys(standingsMap).length > 0
                ? <span style={{ color:"#00aa55" }}>✓ modèle actif</span>
                : "BETONLINE · API-FOOTBALL"}
          </div>
        </div>
        {remaining !== null && (
          <span style={{ fontSize:11, color:"#445" }}><span style={{ color:"#88aacc" }}>{remaining.toLocaleString()}</span> req.</span>
        )}
      </header>

      <div style={{ display:"flex", flex:1, overflow:"hidden", flexWrap:"wrap" }}>
        {/* Colonne gauche - matchs */}
        <div style={{ flex:1, minWidth:300, overflowY:"auto", padding:"16px 20px" }}>
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:10, color:"#445", letterSpacing:1, marginBottom:8 }}>LIGUES</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {LEAGUES.map((l) => {
                const active = selectedLeagues.includes(l.key);
                return (
                  <button key={l.key} onClick={() => toggleLeague(l.key)}
                    style={{ background:active?"#003322":"#0f1320", border:"1px solid "+(active?"#00aa55":"#1e2535"), color:active?"#00ff88":"#556", padding:"5px 10px", borderRadius:20, cursor:"pointer", fontSize:11 }}>
                    {l.flag} {l.label}
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={fetchOdds} disabled={loading}
            style={{ width:"100%", background:loading?"#1a2035":"#00ff88", color:loading?"#445":"#000", border:"none", padding:"10px", borderRadius:8, cursor:loading?"not-allowed":"pointer", fontSize:13, fontWeight:700, marginBottom:14 }}>
            {loading ? "Chargement..." : "CHARGER LES COTES + MODÈLE"}
          </button>

          {error && (
            <div style={{ background:"#1a0a0a", border:"1px solid #aa2222", borderRadius:8, padding:"10px 14px", marginBottom:12, fontSize:12, color:"#ff6666" }}>
              {error}
            </div>
          )}

          {games.length > 0 && (
            <div style={{ fontSize:10, color:"#445", marginBottom:10 }}>
              {games.length} MATCHS · {Object.keys(standingsMap).length > 0
                ? <span style={{ color:"#00aa55" }}>✓ modèle chargé sur {Object.keys(standingsMap).length} ligue(s)</span>
                : <span style={{ color:"#ffcc44" }}>modèle non disponible</span>}
            </div>
          )}

          {games.map((game) => (
            <GameCard key={game.id} game={game} selectedLegs={selectedLegs} onToggleLeg={handleToggleLeg} standingsMap={standingsMap} />
          ))}

          {!loading && games.length === 0 && (
            <div style={{ textAlign:"center", color:"#334", padding:"50px 0", fontSize:13 }}>
              Sélectionne des ligues et charge les cotes
            </div>
          )}
        </div>

        {/* Colonne droite - builder + suggestions */}
        <div style={{ width:360, minWidth:300, background:"#080c18", borderLeft:"1px solid #1a2035", display:"flex", flexDirection:"column", overflowY:"auto" }}>
          <div style={{ display:"flex", borderBottom:"1px solid #1a2035" }}>
            {[{ id:"builder", label:"Builder" }, { id:"suggestions", label:"Top Parlays ("+suggestions.length+")" }].map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ flex:1, padding:"12px 6px", border:"none", cursor:"pointer", fontSize:11, background:activeTab===tab.id?"#0f1320":"transparent", color:activeTab===tab.id?"#00ff88":"#445", borderBottom:activeTab===tab.id?"2px solid #00ff88":"2px solid transparent" }}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding:16, flex:1 }}>
            {activeTab === "builder" && (
              <div>
                <div style={{ fontSize:10, color:"#445", marginBottom:8 }}>JAMBES ({selectedLegs.length})</div>
                {selectedLegs.length === 0 ? (
                  <div style={{ color:"#334", fontSize:12, padding:"24px 0", textAlign:"center" }}>
                    Clique sur les cotes à gauche
                  </div>
                ) : (
                  selectedLegs.map((leg) => <LegRow key={leg.gameId+leg.outcome} leg={leg} onRemove={removeLeg} />)
                )}

                {hasLegs && (
                  <div>
                    <div style={{ background:"#0a0f1a", border:"1px solid #1a2035", borderRadius:10, padding:"14px", marginTop:12, marginBottom:12 }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                        <div>
                          <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>COTE COMBINÉE</div>
                          <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:700, color:"#fff" }}>{fmtAmerican(Math.round((combinedDec-1)*100))}</div>
                          <div style={{ fontSize:10, color:"#445" }}>{combinedDec.toFixed(2)}x</div>
                        </div>
                        <div>
                          <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>PROB MODÈLE</div>
                          <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:700, color:"#88aacc" }}>{fmtPct(modelProb)}</div>
                          <div style={{ fontSize:10, color:"#445" }}>book: {fmtPct(bookProb)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>EV MODÈLE</div>
                          <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:700, color:evc }}>{modelEV>=0?"+":""}{(modelEV*100).toFixed(1)}%</div>
                          <div style={{ fontSize:10, color:"#445" }}>{modelEV>0?"Valeur positive":"Valeur négative"}</div>
                        </div>
                        <div>
                          <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>EDGE MOY</div>
                          <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:700, color:edgeColor(avgEdge) }}>{avgEdge>=0?"+":""}{fmtPct(avgEdge)}</div>
                          <div style={{ fontSize:10, color:"#445" }}>vs BetOnline</div>
                        </div>
                      </div>
                      <div style={{ marginTop:12, borderTop:"1px solid #1a2035", paddingTop:10 }}>
                        <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>GAIN POTENTIEL</div>
                        <div style={{ fontFamily:"monospace", fontSize:22, fontWeight:700, color:"#fff" }}>${potentialWin.toFixed(2)}</div>
                        <div style={{ fontSize:10, color:"#445" }}>pour ${stake}</div>
                      </div>
                    </div>
                    <div style={{ marginBottom:12 }}>
                      <div style={{ fontSize:9, color:"#445", marginBottom:6 }}>MISE ($)</div>
                      <input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value))}
                        style={{ width:"100%", background:"#0f1320", border:"1px solid #1e2535", borderRadius:6, padding:"8px 10px", color:"#ccd", fontFamily:"monospace", fontSize:14, boxSizing:"border-box" }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "suggestions" && (
              <div>
                <div style={{ fontSize:10, color:"#445", marginBottom:4 }}>TOP PARLAYS PAR VALEUR MODÈLE</div>
                <div style={{ fontSize:9, color:"#334", marginBottom:12 }}>
                  Trié par edge vs BetOnline · EV max +60% · Aucune jambe sous -200
                </div>
                {suggestions.length === 0 ? (
                  <div style={{ color:"#334", fontSize:12, padding:"24px 0", textAlign:"center" }}>
                    Charge des cotes d'abord
                  </div>
                ) : (
                  suggestions.map((parlay, i) => (
                    <SuggestionCard key={i} parlay={parlay} index={i} onLoad={loadSuggestion} />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
