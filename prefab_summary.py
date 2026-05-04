"""CineSwipe — Prefab summary view (Python).

Reads data/session_data.json (written by the Node.js server) and builds
a full-featured Prefab UI showing session metrics, saved movies, skipped
movies, charts, and a searchable recommendations table.

Invoked by server.js via:
    prefab export prefab_summary.py -o public/prefab_output.html --bundled
"""

import json
from datetime import datetime
from pathlib import Path

from prefab_ui import PrefabApp
from prefab_ui.components import (
    Alert,
    AlertDescription,
    AlertTitle,
    Badge,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Column,
    Grid,
    Metric,
    Muted,
    Progress,
    Ring,
    Row,
    Separator,
    Tab,
    Tabs,
    Text,
)
from prefab_ui.components.charts import BarChart, ChartSeries, Sparkline

# ── Load session data ─────────────────────────────────────────────────────────
_data_file = Path(__file__).parent / "data" / "session_data.json"
try:
    # utf-8-sig strips the BOM that Windows/Node.js sometimes adds
    _raw = json.loads(_data_file.read_text(encoding="utf-8-sig"))
except Exception:
    _raw = {}

ui_title           = _raw.get("ui_title", "CineSwipe Session")
session_date       = _raw.get("session_date", "")
model_used         = _raw.get("model_used", "")
personalised       = bool(_raw.get("personalised", False))
total_shown        = int(_raw.get("total_shown", 0))
saved_count        = int(_raw.get("saved_count", 0))
all_recs           = _raw.get("all_recommendations", [])
time_taken_seconds = int(_raw.get("time_taken_seconds", 0))

saved_recs   = [r for r in all_recs if r.get("saved")]
skipped_recs = [r for r in all_recs if not r.get("saved")]

ratings      = [float(r["rating_out_of_10"]) for r in all_recs if r.get("rating_out_of_10")]
avg_rating   = f"★ {sum(ratings) / len(ratings):.1f}" if ratings else "—"

saved_ratings = [float(r["rating_out_of_10"]) for r in saved_recs if r.get("rating_out_of_10")]
avg_saved_rating = round(sum(saved_ratings) / len(saved_ratings), 1) if saved_ratings else 0

save_rate = round((saved_count / total_shown * 100)) if total_shown else 0

date_label = ""
if session_date:
    try:
        date_label = datetime.fromisoformat(str(session_date)).strftime("%d %b %Y")
    except Exception:
        date_label = str(session_date)


def _fmt_time(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds}s"
    m, s = divmod(seconds, 60)
    return f"{m}m {s}s"


time_label     = _fmt_time(time_taken_seconds) if time_taken_seconds else "—"
subtitle_parts = [p for p in [date_label, model_used] if p]

# ── Bar chart data ────────────────────────────────────────────────────────────
bar_data = [
    {"category": "Saved",   "count": len(saved_recs)},
    {"category": "Skipped", "count": len(skipped_recs)},
]

# ── Rating sparkline (ratings in session order) ───────────────────────────────
sparkline_data = [float(r.get("rating_out_of_10", 0)) for r in all_recs if r.get("rating_out_of_10")]


def _rec_card(rec: dict) -> None:
    """Render a single movie/TV card."""
    poster_url     = rec.get("poster_url") or ""
    is_real_poster = poster_url.startswith("http")

    with Card():
        if is_real_poster:
            try:
                from prefab_ui.components import Image as PrefabImage
                PrefabImage(
                    src=poster_url,
                    alt=rec.get("title", ""),
                    style="width:100%;border-radius:6px 6px 0 0;object-fit:cover;max-height:200px;",
                )
            except ImportError:
                pass

        with CardHeader():
            CardTitle(rec.get("title", ""))
            CardDescription(f"{rec.get('year', '?')} · {rec.get('genre', '')}")

        with CardContent():
            with Column(gap=2):
                with Row(gap=2):
                    Badge(f"★ {rec.get('rating_out_of_10', '?')}")
                    lbl = "📺 TV" if rec.get("media_type") == "tv" else "🎬 Movie"
                    Badge(lbl, variant="secondary")
                    lang = rec.get("language", "")
                    if lang:
                        Badge(lang, variant="outline")
                    if rec.get("personalised"):
                        Badge("✨", variant="outline")

                why = rec.get("why_recommended") or ""
                if why:
                    Muted(f'"{why}"')


# ── Prefab app ────────────────────────────────────────────────────────────────
with PrefabApp(title=f"🎬 {ui_title}") as app:

    with Column(gap=6):

        # ── ① Header ──────────────────────────────────────────────────────────
        with Row(justify="between", align="start", gap=4):
            with Column(gap=1):
                Text(f"🎬  {ui_title}", bold=True)
                if subtitle_parts:
                    Muted("  ·  ".join(subtitle_parts))
            with Row(gap=2):
                Badge(f"{saved_count} saved")
                Badge(f"{len(skipped_recs)} skipped", variant="secondary")
                if personalised:
                    Badge("✨ Personalised", variant="outline")

        # ── ② Personalised alert ──────────────────────────────────────────────
        if personalised:
            with Alert(variant="info"):
                AlertTitle("✨ Personalised recommendations")
                AlertDescription(
                    "These results were tailored to your taste profile. "
                    "The more you save and rate, the better your profile becomes."
                )

        # ── ③ Stats grid ──────────────────────────────────────────────────────
        with Grid(columns=4, gap=4):
            with Card():
                with CardContent():
                    Metric(label="Saved", value=str(saved_count), delta=f"of {total_shown}")
            with Card():
                with CardContent():
                    Metric(label="Skipped", value=str(len(skipped_recs)))
            with Card():
                with CardContent():
                    Metric(label="Avg rating", value=avg_rating)
            with Card():
                with CardContent():
                    Metric(label="Time taken", value=time_label)

        # ── ④ Save rate ring + bar chart + rating sparkline ──────────────────
        with Grid(columns=3, gap=4):

            # Ring: save rate
            with Card():
                with CardHeader():
                    CardTitle("Save rate")
                with CardContent(css_class="w-fit mx-auto"):
                    Ring(
                        value=save_rate,
                        label=f"{save_rate}%",
                        variant="success" if save_rate >= 50 else "default",
                        size="lg",
                        thickness=12,
                    )

            # Bar chart: saved vs skipped
            with Card():
                with CardHeader():
                    CardTitle("Saved vs Skipped")
                with CardContent():
                    BarChart(
                        data=bar_data,
                        series=[ChartSeries(dataKey="count", label="Count")],
                        x_axis="category",
                        height=160,
                        bar_radius=6,
                        show_tooltip=True,
                        show_grid=True,
                    )

            # Sparkline: rating trend across session
            with Card():
                with CardHeader():
                    CardTitle("Rating trend")
                    if sparkline_data:
                        Muted(f"Avg saved ★{avg_saved_rating}")
                with CardContent():
                    if sparkline_data:
                        Sparkline(
                            data=sparkline_data,
                            variant="info",
                            fill=True,
                            css_class="h-24",
                        )
                    else:
                        Muted("No rating data yet.")

        # ── ④ Save rate progress bar ──────────────────────────────────────────
        with Card():
            with CardContent():
                with Column(gap=2):
                    with Row(justify="between"):
                        Text("Save rate", bold=True)
                        Muted(f"{save_rate}%")
                    Progress(value=save_rate)

        Separator()

        # ── ⑤ Saved / Skipped tabs ────────────────────────────────────────────
        with Tabs(value="saved"):
            with Tab(f"Saved ({len(saved_recs)})", value="saved"):
                if saved_recs:
                    with Grid(columns={"default": 1, "sm": 2, "lg": 3}, gap=4):
                        for rec in saved_recs:
                            _rec_card(rec)
                else:
                    Muted("Nothing was saved this session.")

            with Tab(f"Skipped ({len(skipped_recs)})", value="skipped"):
                if skipped_recs:
                    with Grid(columns={"default": 1, "sm": 2, "lg": 3}, gap=4):
                        for rec in skipped_recs:
                            _rec_card(rec)
                else:
                    Muted("No skipped movies.")

        Separator()

        # ── ⑥ All recommendations — same tile layout as the tabs above ─────────
        with Row(justify="between", align="center", gap=2):
            Text(f"All recommendations ({total_shown})", bold=True)
            with Row(gap=2):
                Badge(f"{saved_count} saved")
                Badge(f"{len(skipped_recs)} skipped", variant="secondary")

        if all_recs:
            with Grid(columns={"default": 1, "sm": 2, "lg": 3}, gap=4):
                for rec in all_recs:
                    _rec_card(rec)
        else:
            Muted("No recommendations in this session.")
