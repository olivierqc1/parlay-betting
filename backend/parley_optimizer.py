# parlay_optimizer.py
# ─────────────────────────────────────────────────────────────────────────────
# Intégration ParlayEdge — déposer dans ton dossier backend
# Dans app.py : from parlay_optimizer import parlay_bp; app.register_blueprint(parlay_bp)
#
# Variables d'env requises (déjà dans ton Render) :
#   ODDS_API_KEY        → The Odds API
#   FOOTBALL_API_KEY    → API-Football (x-apisports-key)
# ─────────────────────────────────────────────────────────────────────────────

import os
import time
import requests
from flask import Blueprint, jsonify, request
from functools import lru_cache
from itertools import combinations

parlay_bp = Blueprint("parlay", __name__)

ODDS_API_KEY     = os.environ.get("ODDS_API_KEY")
FOOTBALL_API_KEY = os.environ.get("FOOTBALL_API_KEY")
ODDS_BASE        = "https://api.the-odds-api.com/v4"
FB_BASE          = "https://v3.football.api-sports.io"

# ── The Odds API sport key  →  API-Football league ID ──────────────────────
LEAGUE_MAP = {
    "soccer_france_ligue_1":  61,
    "soccer_france_ligue_2":  62,
    "soccer_italy_serie_a":  135,
    "soccer_italy_serie_b":  136,
    "soccer_spain_la_liga":  140,
    "soccer_epl":             39,
    "soccer_germany_bundesliga": 78,
    "soccer_usa_mls":        253,
}

# ── Odds helpers ────────────────────────────────────────────────────────────

def american_to_decimal(o):
    o = float(o)
    return o / 100 + 1 if o >= 0 else 100 / abs(o) + 1

def american_to_implied(o):
    o = float(o)
    return abs(o) / (abs(o) + 100) if o < 0 else 100 / (o + 100)

def decimal_to_american(d):
    d = float(d)
    return f"+{round((d-1)*100)}" if d >= 2 else str(round(-100 / (d - 1)))

# ── Standings cache (refreshed every hour) ──────────────────────────────────

@lru_cache(maxsize=64)
def _fetch_standings(league_id: int, season: int, hour_bucket: int) -> dict:
    """
    Returns dict keyed by lowercase team name → stats dict.
    hour_bucket forces cache invalidation every 60 min.
    """
    headers = {
        "x-apisports-key": FOOTBALL_API_KEY,
        "x-rapidapi-host": "v3.football.api-sports.io",
    }
    r = requests.get(
        f"{FB_BASE}/standings",
        headers=headers,
        params={"league": league_id, "season": season},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json()

    result = {}
    try:
        for entry in data["response"][0]["league"]["standings"][0]:
            played = max(entry["all"]["played"] or 1, 1)
            form   = entry.get("form") or ""
            result[entry["team"]["name"].lower()] = {
                "name":         entry["team"]["name"],
                "rank":         entry["rank"],
                "points":       entry["points"],
                "ppg":          entry["points"] / played,
                "gpg_for":      (entry["all"]["goals"]["for"]     or 0) / played,
                "gpg_against":  (entry["all"]["goals"]["against"] or 0) / played,
                "played":       played,
                "form":         form[-5:],          # last 5 chars e.g. "WWDLW"
            }
    except (KeyError, IndexError):
        pass
    return result

def get_standings(league_id, season=2024):
    hour = int(time.time() // 3600)
    try:
        return _fetch_standings(league_id, season, hour)
    except Exception:
        return {}

# ── Value model ─────────────────────────────────────────────────────────────

def form_score(form_str: str) -> float:
    """Convert 'WWDLW' → 0-1 weighted score (most recent = higher weight)."""
    weights = [1, 1.2, 1.4, 1.6, 2.0]          # oldest → newest
    chars   = list((form_str or "")[-5:])
    if not chars:
        return 0.5
    pts_map = {"W": 3, "D": 1, "L": 0}
    total_w = sum(weights[-len(chars):])
    score   = sum(pts_map.get(c, 0) * w for c, w in zip(chars, weights[-len(chars):]))
    return score / (3 * total_w)

def fuzzy_find(name: str, standings: dict):
    """Match a team name against standings keys with fallback."""
    low = name.lower()
    if low in standings:
        return standings[low]
    for key, val in standings.items():
        if low in key or key in low:
            return val
    # Try word overlap
    name_words = set(low.split())
    for key, val in standings.items():
        if name_words & set(key.split()):
            return val
    return None

def compute_real_probs(home_name: str, away_name: str, standings: dict,
                       home_adv: float = 0.04) -> dict | None:
    """
    Expert model — four factors, weighted:
      PPG           40%   (points per game / 3)
      Attack        25%   (goals scored per game / 3)
      Defense       20%   (1 - goals conceded per game / 3)
      Form          15%   (weighted last 5)
      Home bonus    +home_adv to home strength

    Draw probability estimated from closeness of the two teams.
    Returns dict with home/away/draw real probs + metadata, or None.
    """
    h = fuzzy_find(home_name, standings)
    a = fuzzy_find(away_name, standings)
    if not h or not a:
        return None

    def strength(t, is_home):
        s = (
            (t["ppg"] / 3.0)                              * 0.40 +
            (min(t["gpg_for"],  3.0) / 3.0)               * 0.25 +
            (1 - min(t["gpg_against"], 3.0) / 3.0)        * 0.20 +
            form_score(t["form"])                          * 0.15
        )
        if is_home:
            s += home_adv
        return max(0.01, s)

    h_str = strength(h, True)
    a_str = strength(a, False)

    # Draw: more likely when teams are close in strength
    closeness  = 1 - abs(h_str - a_str) / max(h_str, a_str)
    draw_prob  = round(0.18 + closeness * 0.12, 4)   # 18–30 %

    total      = h_str + a_str
    home_prob  = round(h_str / total * (1 - draw_prob), 4)
    away_prob  = round(1 - home_prob - draw_prob, 4)

    return {
        "home": home_prob,
        "away": away_prob,
        "draw": draw_prob,
        "home_rank":   h["rank"],
        "away_rank":   a["rank"],
        "home_form":   h["form"],
        "away_form":   a["form"],
        "home_ppg":    round(h["ppg"], 2),
        "away_ppg":    round(a["ppg"], 2),
        "home_gpg_for":  round(h["gpg_for"], 2),
        "away_gpg_for":  round(a["gpg_for"], 2),
        "rank_gap":    abs(h["rank"] - a["rank"]),
    }

def value_edge(real_prob, implied_prob):
    """Positive = +EV. Negative = -EV."""
    if real_prob is None or implied_prob is None:
        return None
    return round(real_prob - implied_prob, 4)

# ── Routes ───────────────────────────────────────────────────────────────────

@parlay_bp.route("/api/parlay/upcoming", methods=["GET"])
def upcoming_matches():
    """
    Fetch upcoming matches + odds from The Odds API, enrich with value model.

    Query params:
      sports  : comma-separated Odds API sport keys  (default: all in LEAGUE_MAP)
      season  : API-Football season year              (default: 2024)
      days    : lookahead days for odds               (default: 2)
    """
    sports_param = request.args.get("sports", ",".join(LEAGUE_MAP.keys()))
    sports       = [s.strip() for s in sports_param.split(",") if s.strip()]
    season       = int(request.args.get("season", 2024))
    days         = int(request.args.get("days", 2))

    all_matches = []

    for sport_key in sports:
        league_id = LEAGUE_MAP.get(sport_key)

        # 1. Fetch odds ───────────────────────────────────────────────────────
        try:
            r = requests.get(
                f"{ODDS_BASE}/sports/{sport_key}/odds",
                params={
                    "apiKey":      ODDS_API_KEY,
                    "regions":     "us",
                    "markets":     "h2h",
                    "oddsFormat":  "american",
                    "daysFrom":    days,
                },
                timeout=10,
            )
            r.raise_for_status()
            raw_matches = r.json()
        except Exception as e:
            continue

        # 2. Standings for this league ────────────────────────────────────────
        standings = get_standings(league_id, season) if league_id else {}

        # 3. Enrich each match ────────────────────────────────────────────────
        for m in raw_matches[:25]:
            home = m.get("home_team", "")
            away = m.get("away_team", "")

            # Best odds across all bookmakers
            best = {"home": None, "away": None, "draw": None}
            for bm in m.get("bookmakers", []):
                for mkt in bm.get("markets", []):
                    if mkt["key"] != "h2h":
                        continue
                    for oc in mkt.get("outcomes", []):
                        p = oc["price"]
                        if oc["name"] == home:
                            if best["home"] is None or p > best["home"]:
                                best["home"] = p
                        elif oc["name"] == away:
                            if best["away"] is None or p > best["away"]:
                                best["away"] = p
                        elif oc["name"] == "Draw":
                            if best["draw"] is None or p > best["draw"]:
                                best["draw"] = p

            if best["home"] is None or best["away"] is None:
                continue

            # Implied probabilities (vig-adjusted simple)
            imp = {
                "home": round(american_to_implied(best["home"]), 4),
                "away": round(american_to_implied(best["away"]), 4),
            }
            if best["draw"]:
                imp["draw"] = round(american_to_implied(best["draw"]), 4)

            # Real probabilities from model
            real = compute_real_probs(home, away, standings) if standings else None

            # Value edges
            val = None
            if real:
                val = {
                    "home": value_edge(real["home"], imp["home"]),
                    "away": value_edge(real["away"], imp["away"]),
                }

            all_matches.append({
                "id":             m["id"],
                "sport":          sport_key,
                "home_team":      home,
                "away_team":      away,
                "commence_time":  m.get("commence_time"),
                "odds":           best,
                "implied_prob":   imp,
                "real_prob":      real,
                "value":          val,
            })

    # Sort by best positive value edge (home or away)
    def best_val(match):
        v = match.get("value")
        if not v:
            return -99
        return max(v.get("home") or -99, v.get("away") or -99)

    all_matches.sort(key=best_val, reverse=True)
    return jsonify({"matches": all_matches, "count": len(all_matches)})


@parlay_bp.route("/api/parlay/build", methods=["POST"])
def build_parlays():
    """
    Generate all k-leg parlay combinations from a list of picks.

    Body JSON:
      picks     : [{ team, odds, matchup?, value_edge? }]
      leg_size  : int   (default 3)
      stake     : float (default 20)
    """
    body      = request.get_json(force=True)
    picks     = body.get("picks", [])
    leg_size  = int(body.get("leg_size", 3))
    stake     = float(body.get("stake", 20))

    if len(picks) < leg_size:
        return jsonify({"error": f"Need at least {leg_size} picks", "parlays": []}), 400

    parlays = []
    for combo in combinations(picks, leg_size):
        dec = 1.0
        for pick in combo:
            dec *= american_to_decimal(pick["odds"])

        win       = stake * dec - stake
        avg_value = None
        edges     = [p.get("value_edge") for p in combo if p.get("value_edge") is not None]
        if edges:
            avg_value = round(sum(edges) / len(edges), 4)

        parlays.append({
            "legs":          list(combo),
            "decimal_odds":  round(dec, 4),
            "american_odds": decimal_to_american(dec),
            "potential_win": round(win, 2),
            "total_payout":  round(stake + win, 2),
            "avg_value":     avg_value,       # mean edge across legs
        })

    # Sort: positive-value parlays first, then by odds
    parlays.sort(key=lambda x: (
        1 if (x["avg_value"] or -99) > 0 else 0,
        x["decimal_odds"]
    ), reverse=True)

    return jsonify({
        "parlays": parlays,
        "count":   len(parlays),
        "stake":   stake,
    })
