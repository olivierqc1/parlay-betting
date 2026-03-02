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

// Cache simple en mémoire (reset au redémarrage)
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

// Map ligues The Odds API → IDs API-Football
const LEAGUE_MAP = {
  soccer_epl:                { id: 39,  season: 2024 },
  soccer_uefa_champs_league: { id: 2,   season: 2024 },
  soccer_spain_la_liga:      { id: 140, season: 2024 },
  soccer_germany_bundesliga: { id: 78,  season: 2024 },
  soccer_italy_serie_a:      { id: 135, season: 2024 },
  soccer_france_ligue_one:   { id: 61,  season: 2024 },
  soccer_usa_mls:            { id: 253, season: 2024 },
};

async function fetchFootballAPI(endpoint) {
  const res = await fetch(`https://v3.football.api-sports.io/${endpoint}`, {
    headers: {
      "x-apisports-key": FOOTBALL_API_KEY,
    },
  });
  if (!res.ok) throw new Error(`API-Football error: ${res.status}`);
  const json = await res.json();
  return json.response;
}

// Récupère classements d'une ligue
async function getStandings(leagueId, season) {
  const cacheKey = `standings_${leagueId}_${season}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const data = await fetchFootballAPI(`standings?league=${leagueId}&season=${season}`);
  const standings = {};

  const groups = data?.[0]?.league?.standings || [];
  groups.forEach((group) => {
    group.forEach((team) => {
      standings[team.team.name] = {
        rank: team.rank,
        points: team.points,
        played: team.all.played,
        win: team.all.win,
        draw: team.all.draw,
        lose: team.all.lose,
        goalsFor: team.all.goals.for,
        goalsAgainst: team.all.goals.against,
        form: team.form, // ex: "WWDLW"
      };
    });
  });

  setCache(cacheKey, standings, 6 * 60 * 60 * 1000); // 6h cache
  return standings;
}

// Calcule probabilité maison basée sur les stats
function calculateModelProb(homeStats, awayStats, totalTeams) {
  if (!homeStats || !awayStats) return null;

  // 1. Force relative basée sur le classement
  const homeRankScore = (totalTeams - homeStats.rank + 1) / totalTeams;
  const awayRankScore = (totalTeams - awayStats.rank + 1) / totalTeams;

  // 2. Forme récente (5 derniers matchs)
  function formScore(formStr) {
    if (!formStr) return 0.5;
    const last5 = formStr.slice(-5);
    let score = 0;
    for (const c of last5) {
      if (c === "W") score += 1;
      else if (c === "D") score += 0.4;
    }
    return score / 5;
  }
  const homeForm = formScore(homeStats.form);
  const awayForm = formScore(awayStats.form);

  // 3. Ratio buts (attaque vs défense)
  const homeAttack = homeStats.played > 0 ? homeStats.goalsFor / homeStats.played : 1;
  const homeDef = homeStats.played > 0 ? homeStats.goalsAgainst / homeStats.played : 1;
  const awayAttack = awayStats.played > 0 ? awayStats.goalsFor / awayStats.played : 1;
  const awayDef = awayStats.played > 0 ? awayStats.goalsAgainst / awayStats.played : 1;

  // Buts attendus (xG simplifié)
  const homeXG = homeAttack / (awayDef + 0.1);
  const awayXG = awayAttack / (homeDef + 0.1);

  // 4. Avantage domicile (historiquement ~60% des pts)
  const homeBonus = 0.08;

  // Score composite
  const homeScore = (homeRankScore * 0.35) + (homeForm * 0.35) + (homeXG / (homeXG + awayXG + 0.01) * 0.30) + homeBonus;
  const awayScore = (awayRankScore * 0.35) + (awayForm * 0.35) + (awayXG / (homeXG + awayXG + 0.01) * 0.30);

  const total = homeScore + awayScore + 0.25; // 0.25 = probabilité nul implicite
  const homeProb = homeScore / total;
  const awayProb = awayScore / total;
  const drawProb = 1 - homeProb - awayProb;

  return {
    home: Math.max(0.05, Math.min(0.85, homeProb)),
    away: Math.max(0.05, Math.min(0.85, awayProb)),
    draw: Math.max(0.05, Math.min(0.40, drawProb)),
  };
}

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ParlayEdge API running" });
});

// Odds endpoint
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
    res.json({
      data,
      meta: {
        remainingRequests: remaining ? parseInt(remaining) : null,
        usedRequests: used ? parseInt(used) : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint modèle de probabilité
app.get("/api/model/:sport", async (req, res) => {
  const { sport } = req.params;
  const league = LEAGUE_MAP[sport];
  if (!league) return res.status(400).json({ error: "Ligue non supportée" });
  if (!FOOTBALL_API_KEY) return res.status(500).json({ error: "FOOTBALL_API_KEY not configured" });

  try {
    const standings = await getStandings(league.id, league.season);
    const totalTeams = Object.keys(standings).length;
    res.json({ standings, totalTeams });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ParlayEdge backend running on port ${PORT}`);
});
