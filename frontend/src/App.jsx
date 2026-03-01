import { useState, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

const LEAGUES = [
  { key: "soccer_epl",                label: "Premier League",   flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { key: "soccer_uefa_champs_league", label: "Champions League", flag: "⭐" },
  { key: "soccer_spain_la_liga",      label: "La Liga",          flag: "🇪🇸" },
  { key: "soccer_germany_bundesliga", label: "Bundesliga",       flag: "🇩🇪" },
  { key: "soccer_italy_serie_a",      label: "Serie A",          flag: "🇮🇹" },
  { key: "soccer_france_ligue_one",   label: "Ligue 1",          flag: "🇫🇷" },
  { key: "soccer_usa_mls",            label: "MLS",              flag: "🇺🇸" },
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
function calcCombinedFairProb(legs) {
  return legs.reduce((acc, l) => acc * l.noVigProb, 1);
}
function calcEV(combinedDec, fairProb) {
  return fairProb * combinedDec - 1;
}
function fmtAmerican(odds) {
  return odds > 0 ? `+${Math.round(odds)}` : `${Math.round(odds)}`;
}
function fmtPct(p) {
  return `${(p * 100).toFixed(1)}%`;
}
function evColor(ev) {
  if (ev > 0.05) return "#00ff88";
  if (ev > 0) return "#88ffcc";
  if (ev > -0.05) return "#ffcc44";
  return "#ff5555";
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

function buildSuggestions(games, topN = 8) {
  const allLegs = [];
  games.forEach((game) => {
    const market = game.bookmakers?.[0]?.markets?.[0];
    if (!market) return;
    const nvps = calcNoVigProbs(market.outcomes);
    market.outcomes.forEach((outcome, i) => {
      allLegs.push({
        gameId: game.id,
        gameLabel: `${game.home_team} vs ${game.away_team}`,
        outcome: outcome.name,
        price: outcome.price,
        noVigProb: nvps[i],
      });
    });
  });
  const results = [];
  [2, 3].forEach((size) => {
    getCombinations(allLegs, size).forEach((combo) => {
      const ids = combo.map((l) => l.gameId);
      if (new Set(ids).size !== ids.length) return;
      const combinedDec = calcCombinedDecimal(combo);
      const fairProb = calcCombinedFairProb(combo);
      const ev = calcEV(combinedDec, fairProb);
      results.push({ legs: combo, combinedDec, fairProb, ev });
    });
  });
  return results.sort((a, b) => b.ev - a.ev).slice(0, topN);
}

function LegRow({ leg, onRemove }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 12px", background: "#1a1f2e", borderRadius: 6,
      borderLeft: "3px solid #00ff88", marginBottom: 6,
    }}>
      <div>
        <div style={{ fontSize: 10, color: "#556", marginBottom: 2 }}>{leg.gameLabel}</div>
        <div style={{ fontSize: 13, color: "#eee", fontWeight: 600 }}>{leg.outcome}</div>
        <div style={{ fontSize: 10, color: "#445", marginTop: 1 }}>no-vig {fmtPct(leg.noVigProb)}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: "#00ff88", fontFamily: "monospace", fontSize: 15, fontWeight: 700 }}>
          {fmtAmerican(leg.price)}
        </span>
        <button
          onClick={() => onRemove(leg)}
          style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 0 }}
        >x</button>
      </div>
    </div>
  );
}

function GameCard({ game, selectedLegs, onToggleLeg }) {
  const market = game.bookmakers?.[0]?.markets?.[0];
  if (!market) return null;
  const nvps = calcNoVigProbs(market.outcomes);
  const date = new Date(game.commence_time);
  const dateStr = date.toLocaleDateString("fr-CA", { month: "short", day: "numeric" });
  const timeStr = date.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });

  function isSelected(name) {
    return selectedLegs.some((l) => l.gameId === game.id && l.outcome === name);
  }
  function outcomeLabel(name) {
    if (name === game.home_team) return "Dom.";
    if (name === game.away_team) return "Vis.";
    return "Nul";
  }

  return (
    <div style={{ background: "#0f1320", border: "1px solid #1e2535", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#445" }}>{dateStr} - {timeStr}</span>
        <span style={{ fontSize: 10, color: "#334" }}>{game.sport_title}</span>
      </div>
      <div style={{ fontSize: 12, color: "#aab", marginBottom: 10, textAlign: "center", fontWeight: 600 }}>
        {game.home_team} vs {game.away_team}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
        {market.outcomes.map((outcome, idx) => {
          const sel = isSelected(outcome.name);
          return (
            <button
              key={outcome.name}
              onClick={() => onToggleLeg(game, outcome, nvps[idx])}
              style={{
                background: sel ? "#003322" : "#141927",
                border: `1px solid ${sel ? "#00aa55" : "#1e2535"}`,
                borderRadius: 7, padding: "8px 4px",
                cursor: "pointer", textAlign: "center",
              }}
            >
              <div style={{ fontSize: 10, color: sel ? "#00ff88" : "#556", marginBottom: 3 }}>
                {outcomeLabel(outcome.name)}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: sel ? "#00ff88" : "#ddd" }}>
                {fmtAmerican(outcome.price)}
              </div>
              <div style={{ fontSize: 9, color: "#334", marginTop: 2 }}>{fmtPct(nvps[idx])}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SuggestionCard({ parlay, index, onLoad }) {
  const color = evColor(parlay.ev);
  const shortLabel = (label) =>
    label.split(" vs ").map((t) => t.split(" ").slice(-1)[0]).join(" v ");
  return (
    <div
      onClick={() => onLoad(parlay)}
      style={{
        background: "#0a0f1a",
        border: `1px solid ${parlay.ev > 0 ? "#1a3a2a" : "#1a1e2e"}`,
        borderRadius: 10, padding: "12px 14px", marginBottom: 8, cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#445", letterSpacing: 1 }}>
          #{index + 1} - {parlay.legs.length} JAMBES
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#778", fontFamily: "monospace" }}>
            {fmtAmerican(Math.round((parlay.combinedDec - 1) * 100))}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}22`, padding: "2px 8px", borderRadius: 20 }}>
            EV {parlay.ev > 0 ? "+" : ""}{(parlay.ev * 100).toFixed(1)}%
          </span>
        </div>
      </div>
      {parlay.legs.map((leg, i) => (
        <div key={i} style={{
          display: "flex", justifyContent: "space-between", padding: "3px 0",
          borderBottom: i < parlay.legs.length - 1 ? "1px solid #111" : "none",
        }}>
          <span style={{ fontSize: 11, color: "#667" }}>
            {leg.outcome.split(" ").slice(-1)[0]}
            <span style={{ color: "#334", fontSize: 10 }}> - {shortLabel(leg.gameLabel)}</span>
          </span>
          <span style={{ fontSize: 11, color: "#00cc66", fontFamily: "monospace" }}>
            {fmtAmerican(leg.price)}
          </span>
        </div>
      ))}
      <div style={{ marginTop: 8, display: "flex", gap: 14 }}>
        <span style={{ fontSize: 10, color: "#334" }}>
          Prob: <span style={{ color: "#88aacc" }}>{fmtPct(parlay.fairProb)}</span>
        </span>
        <span style={{ fontSize: 10, color: "#334" }}>{parlay.combinedDec.toFixed(2)}x</span>
      </div>
    </div>
  );
}

export default function App() {
  const [selectedLeagues, setSelectedLeagues] = useState(["soccer_epl", "soccer_uefa_champs_league"]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(null);
  const [selectedLegs, setSelectedLegs] = useState([]);
  const [stake, setStake] = useState(100);
  const [suggestions, setSuggestions] = useState([]);
  const [activeTab, setActiveTab] = useState("builder");

  const fetchOdds = useCallback(async () => {
    if (selectedLeagues.length === 0) return;
    setLoading(true);
    setError("");
    setGames([]);
    setSuggestions([]);
    try {
      const all = [];
      for (const sport of selectedLeagues) {
        const res = await fetch(`${API_BASE}/api/odds?sport=${sport}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
        if (json.meta?.remainingRequests != null) setRemaining(json.meta.remainingRequests);
        all.push(...(json.data || []).filter((g) => g.bookmakers?.length > 0));
      }
      all.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
      setGames(all);
      if (all.length > 0) setSuggestions(buildSuggestions(all));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedLeagues]);

  function toggleLeague(key) {
    setSelectedLeagues((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function handleToggleLeg(game, outcome, noVigProb) {
    setSelectedLegs((prev) => {
      const already = prev.find((l) => l.gameId === game.id && l.outcome === outcome.name);
      if (already) return prev.filter((l) => !(l.gameId === game.id && l.outcome === outcome.name));
      const withoutGame = prev.filter((l) => l.gameId !== game.id);
      return [...withoutGame, {
        gameId: game.id,
        gameLabel: `${game.home_team} vs ${game.away_team}`,
        outcome: outcome.name,
        price: outcome.price,
        noVigProb,
      }];
    });
  }

  function removeLeg(leg) {
    setSelectedLegs((prev) =>
      prev.filter((l) => !(l.gameId === leg.gameId && l.outcome === leg.outcome))
    );
  }

  function loadSuggestion(parlay) {
    setSelectedLegs(parlay.legs.map((l) => ({ ...l })));
    setActiveTab("builder");
  }

  const hasLegs = selectedLegs.length >= 2;
  const combinedDec = hasLegs ? calcCombinedDecimal(selectedLegs) : 1;
  const fairProb = hasLegs ? calcCombinedFairProb(selectedLegs) : 1;
  const ev = hasLegs ? calcEV(combinedDec, fairProb) : 0;
  const potentialWin = stake * combinedDec - stake;
  const evc = evColor(ev);

  return (
    <div style={{
      minHeight: "100vh", background: "#070b14", color: "#ccd",
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      display: "flex", flexDirection: "column",
    }}>
      <header style={{
        background: "#0a0f1c", borderBottom: "1px solid #1a2035",
        padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22 }}>S</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#00ff88", letterSpacing: 2 }}>
              PARLAY<span style={{ color: "#fff" }}>EDGE</span>
            </div>
            <div style={{ fontSize: 10, color: "#445", letterSpacing: 1 }}>BETONLINE - THE ODDS API</div>
          </div>
        </div>
        {remaining !== null && (
          <span style={{ fontSize: 11, color: "#445" }}>
            <span style={{ color: "#88aacc" }}>{remaining.toLocaleString()}</span> req. restantes
          </span>
        )}
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 300, overflowY: "auto", padding: "16px 20px" }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#445", letterSpacing: 1, marginBottom: 8 }}>LIGUES</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {LEAGUES.map((l) => {
                const active = selectedLeagues.includes(l.key);
                return (
                  <button key={l.key} onClick={() => toggleLeague(l.key)} style={{
                    background: active ? "#003322" : "#0f1320",
                    border: `1px solid ${active ? "#00aa55" : "#1e2535"}`,
                    color: active ? "#00ff88" : "#556",
                    padding: "5px 10px", borderRadius: 20, cursor: "pointer", fontSize: 11,
                  }}>
                    {l.flag} {l.label}
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={fetchOdds} disabled={loading} style={{
            width: "100%", background: loading ? "#1a2035" : "#00ff88",
            color: loading ? "#445" : "#000", border: "none",
            padding: "10px", borderRadius: 8, cursor: loading ? "not-allowed" : "pointer",
            fontSize: 13, fontWeight: 700, letterSpacing: 1, marginBottom: 14,
          }}>
            {loading ? "Chargement..." : "CHARGER LES COTES BETONLINE"}
          </button>

          {error && (
            <div style={{
              background: "#1a0a0a", border: "1px solid #aa2222",
              borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#ff6666",
            }}>
              {error}
            </div>
          )}

          {games.length > 0 && (
            <div style={{ fontSize: 10, color: "#445", marginBottom: 10, letterSpacing: 1 }}>
              {games.length} MATCHS
            </div>
          )}

          {games.map((game) => (
            <GameCard key={game.id} game={game} selectedLegs={selectedLegs} onToggleLeg={handleToggleLeg} />
          ))}

          {!loading && games.length === 0 && (
            <div style={{ textAlign: "center", color: "#334", padding: "50px 0", fontSize: 13 }}>
              Selectionne des ligues et charge les cotes
            </div>
          )}
        </div>

        <div style={{
          width: 360, minWidth: 300, background: "#080c18",
          borderLeft: "1px solid #1a2035", display: "flex", flexDirection: "column", overflowY: "auto",
        }}>
          <div style={{ display: "flex", borderBottom: "1px solid #1a2035" }}>
            {[
              { id: "builder", label: "Builder" },
              { id: "suggestions", label: `Suggestions (${suggestions.length})` },
            ].map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                flex: 1, padding: "12px 6px", border: "none", cursor: "pointer", fontSize: 11,
                background: activeTab === tab.id ? "#0f1320" : "transparent",
                color: activeTab === tab.id ? "#00ff88" : "#445",
                borderBottom: activeTab === tab.id ? "2px solid #00ff88" : "2px solid transparent",
              }}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: 16, flex: 1 }}>
            {activeTab === "builder" && (
              <div>
                <div style={{ fontSize: 10, color: "#445", letterSpacing: 1, marginBottom: 8 }}>
                  JAMBES ({selectedLegs.length})
                </div>
                {selectedLegs.length === 0 ? (
                  <div style={{ color: "#334", fontSize: 12, padding: "24px 0", textAlign: "center" }}>
                    Clique sur les cotes a gauche pour construire ton parlay
                  </div>
                ) : (
                  selectedLegs.map((leg) => (
                    <LegRow key={`${leg.gameId}-${leg.outcome}`} leg={leg} onRemove={removeLeg} />
                  ))
                )}

                {hasLegs && (
                  <div>
                    <div style={{
                      background: "#0a0f1a", border: "1px solid #1a2035",
                      borderRadius: 10, padding: "14px", marginTop: 12, marginBottom: 12,
                    }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <div>
                          <div style={{ fontSize: 9, color: "#445", letterSpacing: 1, marginBottom: 4 }}>COTE COMBINEE</div>
                          <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: "#fff" }}>
                            {fmtAmerican(Math.round((combinedDec - 1) * 100))}
                          </div>
                          <div style={{ fontSize: 10, color: "#445" }}>{combinedDec.toFixed(2)}x decimal</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: "#445", letterSpacing: 1, marginBottom: 4 }}>PROB. NO-VIG</div>
                          <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: "#88aacc" }}>
                            {fmtPct(fairProb)}
                          </div>
                          <div style={{ fontSize: 10, color: "#445" }}>prob. juste</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: "#445", letterSpacing: 1, marginBottom: 4 }}>EV</div>
                          <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: evc }}>
                            {ev > 0 ? "+" : ""}{(ev * 100).toFixed(1)}%
                          </div>
                          <div style={{ fontSize: 10, color: "#445" }}>
                            {ev > 0 ? "Valeur positive" : "Valeur negative"}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: "#445", letterSpacing: 1, marginBottom: 4 }}>GAIN POTENTIEL</div>
                          <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: "#fff" }}>
                            ${potentialWin.toFixed(2)}
                          </div>
                          <div style={{ fontSize: 10, color: "#445" }}>pour ${stake}</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 9, color: "#445", letterSpacing: 1, marginBottom: 6 }}>MISE ($)</div>
                      <input
                        type="number"
                        value={stake}
                        onChange={(e) => setStake(Number(e.target.value))}
                        style={{
                          width: "100%", background: "#0f1320", border: "1px solid #1e2535",
                          borderRadius: 6, padding: "8px 10px", color: "#ccd",
                          fontFamily: "monospace", fontSize: 14,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "suggestions" && (
              <div>
                <div style={{ fontSize: 10, color: "#445", letterSpacing: 1, marginBottom: 10 }}>
                  MEILLEURS PARLAYS SUGGERES
                </div>
                {suggestions.length === 0 ? (
 