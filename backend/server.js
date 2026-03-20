const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;

app.use(cors());
app.use(express.json());

// ─── Cache simple ─────────────────────────────────────────────────────────────
const cache = {};
function getCache(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) return null;
  return entry.data;
}
function setCache(key, data, ttlMs) {
  cache[key] = { data, timestamp: Date.now(), ttl: ttlMs };
}

// ─── Ligues ───────────────────────────────────────────────────────────────────
const LEAGUE_MAP = {
  soccer_epl:                    { id: 39,  season: 2024 },
  soccer_uefa_champs_league:     { id: 2,   season: 2024 },
  soccer_spain_la_liga:          { id: 140, season: 2024 },
  soccer_germany_bundesliga:     { id: 78,  season: 2024 },
  soccer_italy_serie_a:          { id: 135, season: 2024 },
  soccer_france_ligue_one:       { id: 61,  season: 2024 },
  soccer_france_ligue_2:         { id: 62,  season: 2024 },
  soccer_france_ligue_nationale: { id: 63,  season: 2024 },
  soccer_italy_serie_b:          { id: 136, season: 2024 },
  soccer_spain_segunda_division: { id: 141, season: 2024 },
  soccer_germany_bundesliga2:    { id: 79,  season: 2024 },
  soccer_usa_mls:                { id: 253, season: 2024 },
};

// ─── Matching équipes ─────────────────────────────────────────────────────────
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

// ─── Fetch standings ──────────────────────────────────────────────────────────
async function fetchFootballAPI(endpoint) {
  const res = await fetch(`https://v3.football.api-sports.io/${endpoint}`, {
    headers: { "x-apisports-key": FOOTBALL_API_KEY },
  });
  if (!res.ok) throw new Error(`API-Football error: ${res.status}`);
  return (await res.json()).response;
}

async function getStandings(leagueId, season) {
  const key = `standings_${leagueId}_${season}`;
  const cached = getCache(key);
  if (cached) return cached;

  const data = await fetchFootballAPI(`standings?league=${leagueId}&season=${season}`);
  const standings = {};
  const groups = data?.[0]?.league?.standings || [];
  groups.forEach(group => {
    group.forEach(team => {
      standings[team.team.name] = {
        rank: team.rank,
        points: team.points,
        played: team.all.played,
        win: team.all.win,
        draw: team.all.draw,
        lose: team.all.lose,
        goalsFor: team.all.goals.for,
        goalsAgainst: team.all.goals.against,
        form: team.form || "",
        homeWin: team.home?.win || 0,
        homePlayed: team.home?.played || 0,
        awayWin: team.away?.win || 0,
        awayPlayed: team.away?.played || 0,
        homeGoalsFor: team.home?.goals?.for || 0,
        awayGoalsFor: team.away?.goals?.for || 0,
        homeGoalsAgainst: team.home?.goals?.against || 0,
        awayGoalsAgainst: team.away?.goals?.against || 0,
      };
    });
  });

  setCache(key, standings, 6 * 60 * 60 * 1000); // 6h
  return standings;
}

// ─── Modèle probabilités ─────────────────────────────────────────────────────
function formScore(formStr) {
  if (!formStr) return 0.45;
  const last5 = formStr.slice(-5);
  let s = 0, c = 0;
  for (const ch of last5) { if (ch === "W") s += 1; else if (ch === "D") s += 0.5; c++; }
  return c > 0 ? s / c : 0.45;
}

function calcModelProbsForGame(homeTeam, awayTeam, standings) {
  const hM = findTeamInStandings(homeTeam, standings);
  const aM = findTeamInStandings(awayTeam, standings);
  if (!hM || !aM) return null;
  const h = hM.stats, a = aM.stats;
  const maxPts = Math.max(h.played, a.played, 1) * 3;
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
    home:            Math.max(0.10, Math.min(0.75, rawH / rawTot)),
    away:            Math.max(0.10, Math.min(0.65, rawA / rawTot)),
    draw:            Math.max(0.15, Math.min(0.35, rawD / rawTot)),
    homeRank:        hM.stats.rank,
    awayRank:        aM.stats.rank,
    homeForm:        h.form?.slice(-5) || "",
    awayForm:        a.form?.slice(-5) || "",
    homePpg:         parseFloat((h.points / Math.max(h.played, 1)).toFixed(2)),
    awayPpg:         parseFloat((a.points / Math.max(a.played, 1)).toFixed(2)),
    rankGap:         Math.abs(hM.stats.rank - aM.stats.rank),
    matchConfidence: Math.min(hM.score, aM.score),
  };
}

// ─── Odds helpers ─────────────────────────────────────────────────────────────
function americanToDecimal(o) {
  const n = parseFloat(o);
  return n >= 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}
function americanToImplied(o) {
  const n = parseFloat(o);
  return n < 0 ? Math.abs(n) / (Math.abs(n) + 100) : 100 / (n + 100);
}
function decimalToAmerican(d) {
  return d >= 2 ? `+${Math.round((d - 1) * 100)}` : `${Math.round(-100 / (d - 1))}`;
}

// ─── Combos ───────────────────────────────────────────────────────────────────
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...tail] = arr;
  return [
    ...combinations(tail, k - 1).map(c => [head, ...c]),
    ...combinations(tail, k),
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
// ROUTES EXISTANTES
// ═════════════════════════════════════════════════════════════════════════════

app.get("/", (req, res) => {
  res.json({ status: "ParlayEdge API running ✅" });
});

app.get("/api/odds", async (req, res) => {
  const { sport, markets = "h2h", regions = "us", bookmakers = "betonlineag" } = req.query;
  if (!sport) return res.status(400).json({ error: "sport param required" });
  if (!ODDS_API_KEY) return res.status(500).json({ error: "ODDS_API_KEY not configured" });
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${ODDS_API_KEY}&regions=${regions}&markets=${markets}&bookmakers=${bookmakers}&oddsFormat=american`;
    const response = await fetch(url);
    const remaining = response.headers.get("x-requests-remaining");
    const used = response.headers.get("x-requests-used");
    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.message || "Odds API error" });
    }
    const data = await response.json();
    res.json({ data, meta: { remainingRequests: remaining ? parseInt(remaining) : null, usedRequests: used ? parseInt(used) : null } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/model/:sport", async (req, res) => {
  const { sport } = req.params;
  const league = LEAGUE_MAP[sport];
  if (!league) return res.status(400).json({ error: "Ligue non supportee" });
  if (!FOOTBALL_API_KEY) return res.status(500).json({ error: "FOOTBALL_API_KEY not configured" });
  try {
    const standings = await getStandings(league.id, league.season);
    res.json({ standings, totalTeams: Object.keys(standings).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/debug/match", async (req, res) => {
  const { team, sport } = req.query;
  const league = LEAGUE_MAP[sport];
  if (!league) return res.status(400).json({ error: "sport invalide" });
  const standings = await getStandings(league.id, league.season);
  const result = findTeamInStandings(team, standings);
  res.json({ searched: team, result, allTeams: Object.keys(standings) });
});

// ═════════════════════════════════════════════════════════════════════════════
// PARLAY OPTIMIZER — nouvelles routes
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/parlay/upcoming
// Fetch matchs à venir (toutes ligues) + enrichit avec value model
// Query: sports (comma-sep), days (int, défaut 2), season (int, défaut 2024)
app.get("/api/parlay/upcoming", async (req, res) => {
  if (!ODDS_API_KEY) return res.status(500).json({ error: "ODDS_API_KEY not configured" });

  const sportKeys = req.query.sports
    ? req.query.sports.split(",").map(s => s.trim()).filter(Boolean)
    : Object.keys(LEAGUE_MAP);
  const season = parseInt(req.query.season || 2024);
  const days   = parseInt(req.query.days   || 2);

  const allMatches = [];

  for (const sportKey of sportKeys) {
    const leagueConf = LEAGUE_MAP[sportKey];

    // 1. Cotes via The Odds API ─────────────────────────────────────────────
    let rawMatches = [];
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american&daysFrom=${days}`;
      const r = await fetch(url, { timeout: 10000 });
      if (!r.ok) continue;
      rawMatches = await r.json();
    } catch (e) {
      console.warn(`[parlay] odds fetch failed for ${sportKey}:`, e.message);
      continue;
    }

    // 2. Standings API-Football ────────────────────────────────────────────
    let standings = null;
    if (leagueConf && FOOTBALL_API_KEY) {
      try {
        standings = await getStandings(leagueConf.id, leagueConf.season || season);
      } catch (e) {
        console.warn(`[parlay] standings failed for ${sportKey}:`, e.message);
      }
    }

    // 3. Enrichir chaque match ─────────────────────────────────────────────
    for (const m of rawMatches.slice(0, 25)) {
      const home = m.home_team;
      const away = m.away_team;

      // Meilleures cotes tous bookmakers confondus
      const best = { home: null, away: null, draw: null };
      for (const bm of m.bookmakers || []) {
        for (const mkt of bm.markets || []) {
          if (mkt.key !== "h2h") continue;
          for (const oc of mkt.outcomes || []) {
            const p = oc.price;
            if (oc.name === home  && (best.home === null || p > best.home))  best.home  = p;
            else if (oc.name === away && (best.away === null || p > best.away))  best.away  = p;
            else if (oc.name === "Draw" && (best.draw === null || p > best.draw)) best.draw = p;
          }
        }
      }
      if (best.home === null || best.away === null) continue;

      // Probs implicites
      const impliedProb = {
        home: parseFloat(americanToImplied(best.home).toFixed(4)),
        away: parseFloat(americanToImplied(best.away).toFixed(4)),
        ...(best.draw != null ? { draw: parseFloat(americanToImplied(best.draw).toFixed(4)) } : {}),
      };

      // Probs modèle + value edge
      const realProb = standings ? calcModelProbsForGame(home, away, standings) : null;
      const value = realProb ? {
        home: parseFloat((realProb.home - impliedProb.home).toFixed(4)),
        away: parseFloat((realProb.away - impliedProb.away).toFixed(4)),
      } : null;

      allMatches.push({
        id:           m.id,
        sport:        sportKey,
        homeTeam:     home,
        awayTeam:     away,
        commenceTime: m.commence_time,
        odds:         best,
        impliedProb,
        realProb,
        value,
      });
    }
  }

  // Trier: meilleur value edge en premier
  allMatches.sort((a, b) => {
    const va = a.value ? Math.max(a.value.home ?? -99, a.value.away ?? -99) : -99;
    const vb = b.value ? Math.max(b.value.home ?? -99, b.value.away ?? -99) : -99;
    return vb - va;
  });

  res.json({ matches: allMatches, count: allMatches.length });
});


// POST /api/parlay/build
// Génère toutes les combos k-legs depuis une liste de picks
// Body: { picks: [{team, odds, matchup?, valueEdge?}], legSize: int, stake: float }
app.post("/api/parlay/build", (req, res) => {
  const { picks = [], legSize = 3, stake = 20 } = req.body;

  if (picks.length < legSize) {
    return res.status(400).json({ error: `Besoin d'au moins ${legSize} picks`, parlays: [] });
  }

  const parlays = combinations(picks, legSize).map(legs => {
    const dec  = legs.reduce((acc, p) => acc * americanToDecimal(p.odds), 1);
    const win  = stake * dec - stake;
    const edges = legs.map(l => l.valueEdge).filter(v => v != null);
    const avgEdge = edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : null;
    return {
      legs,
      decimalOdds:  parseFloat(dec.toFixed(4)),
      americanOdds: decimalToAmerican(dec),
      potentialWin: parseFloat(win.toFixed(2)),
      totalPayout:  parseFloat((stake + win).toFixed(2)),
      avgEdge:      avgEdge != null ? parseFloat(avgEdge.toFixed(4)) : null,
    };
  });

  // +EV en premier, puis par cotes
  parlays.sort((a, b) => {
    const aPos = (a.avgEdge ?? -99) > 0 ? 1 : 0;
    const bPos = (b.avgEdge ?? -99) > 0 ? 1 : 0;
    if (bPos !== aPos) return bPos - aPos;
    return b.decimalOdds - a.decimalOdds;
  });

  res.json({ parlays, count: parlays.length, stake });
});

// ═════════════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`ParlayEdge backend running on port ${PORT}`);
  console.log(`Parlay Optimizer: GET /api/parlay/upcoming · POST /api/parlay/build`);
});