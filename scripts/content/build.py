"""Builds book.html: every PRIMUS problem statement and crisis card, in detail, for the game's sectors (today FMCG,
Aviation and Luxury), optionally with extra sectors from the library.

The card texts are read from the game's own files (seed/sectors/*.csv and prompts/MEMO.md), so the book always says
exactly what teams see on screen. The game's sectors are whatever seed/sectors holds (pnpm sectors --pick …); extra
sectors from seed/sectors/all can be added as a fourth argument (e.g. Energy,Fintech).
Usage: python3 -I build.py <repo root> <sector content .py> <out.html> [extra sectors]
"""
import csv
import html
import importlib.util
import re
import sys
from pathlib import Path

ROOT, CONTENT, OUT = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
EXTRAS = [x.strip() for x in sys.argv[4].split(",") if x.strip()] if len(sys.argv) > 4 else []
HERE = Path(__file__).resolve().parent


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


book = load(CONTENT, "sector_content")
details = load(HERE / "details.py", "details")
portfolios = load(HERE / "portfolios.py", "portfolios")
final = load(HERE / "final_case.py", "final_case")
e = html.escape

problems = list(csv.DictReader(open(ROOT / "seed/sectors/problem-cards.csv", encoding="utf-8")))
crises = list(csv.DictReader(open(ROOT / "seed/sectors/crisis-cards.csv", encoding="utf-8")))
statements = list(csv.DictReader(open(ROOT / "seed/sectors/statements.csv", encoding="utf-8")))
memo_md = (ROOT / "prompts/MEMO.md").read_text(encoding="utf-8")
case = re.search(r"## The case\n\n(.+?)\n\n## ", memo_md, re.S).group(1).strip()

SECTOR_KEY = {"Luxury": "LUXURY", "FMCG": "FMCG", "Energy": "ENERGY", "Aviation": "AVIATION", "Fintech": "FINTECH"}
context = {s["name"]: dict(s) for s in book.SECTORS}
context["AVIATION"].update(final.AVIATION_CONTEXT)
context["LUXURY"]["spare"] = list(context["LUXURY"]["spare"]) + [final.LUXURY_SPARE_EXTRA]
COLOUR = {"Luxury": ("#6d28d9", "#f4effe", "#e6dbfb"), "FMCG": ("#15803d", "#edf8f1", "#d3eedd"), "Energy": ("#b45309", "#fdf6e8", "#f6e4c2"),
          "Aviation": ("#0369a1", "#eaf4fb", "#cfe6f5"), "Fintech": ("#be185d", "#fdf0f6", "#f7d6e5")}
CATEGORY = {"Operations": "#c2410c", "Market": "#1d4ed8", "Trust": "#be123c", "Money": "#4d7c0f"}
all_crises = list(csv.DictReader(open(ROOT / "seed/sectors/all/crisis-cards.csv", encoding="utf-8")))
all_statements = list(csv.DictReader(open(ROOT / "seed/sectors/all/statements.csv", encoding="utf-8")))
# The guidance for a Round 3 statement is kept by its number in the five-sector library; a game's files number them
# again, so it is found by title.
LIB_NO = {(x["sector"], x["title"]): int(x["number"]) for x in all_statements}

# ───── The final case: the organisers' cards replace the game files' texts in this book ─────
GUIDE = {}
for x in crises:
    key = (x["sector"], int(x["number"]))
    o = final.CRISES.get(key) or (final.AVIATION_CRISES.get(key[1]) if x["sector"] == "Aviation" else None)
    if o:
        x.update(category=o["category"], title=o["title"], body=o["body"])
        details.CRISES[key] = {k: o[k] for k in ("on_card", "impact", "plan", "advice", "watch")}
for p in problems:
    if p["sector"] == "Aviation":
        p.update(title=final.AVIATION_PROBLEM["title"], body=final.AVIATION_PROBLEM["body"])
aviation_rows = [x for x in statements if x["sector"] == "Aviation"]
assert len(aviation_rows) == len(final.AVIATION_STATEMENTS) == 10
for x, (title, who, nums, catch, win, guide) in zip(aviation_rows, final.AVIATION_STATEMENTS):
    x.update(title=title, cap="5", body=f"Aviation · Round 3. {title}.\n\nWho it is for: {who}\nThe numbers: {nums}\nThe catch: {catch}\nYou win if: {win}")
    GUIDE[("Aviation", title)] = guide

IN_GAME = [p["sector"] for p in problems]
N = len(IN_GAME)
# The lottery splits 50 squads as equally as it can, the first sectors taking the extra squads.
SQUADS = {name: 50 // N + (1 if i < 50 % N else 0) for i, name in enumerate(IN_GAME)}
assert len(crises) == 4 * N and len(statements) == 10 * N, "deck sizes changed"

sectors_out = [{"name": p["sector"], "in_game": True, "problem": p,
                "crises": [x for x in crises if x["sector"] == p["sector"]],
                "statements": [x for x in statements if x["sector"] == p["sector"]]} for p in problems]
all_problems = {p["sector"]: p for p in csv.DictReader(open(ROOT / "seed/sectors/all/problem-cards.csv", encoding="utf-8"))}
for name in EXTRAS:
    assert name in all_problems and name not in IN_GAME, name
    sectors_out.append({
        "name": name, "in_game": False,
        "problem": {"number": None, "title": all_problems[name]["title"], "body": all_problems[name]["body"]},
        "crises": [x for x in all_crises if x["sector"] == name],
        "statements": [x for x in all_statements if x["sector"] == name],
    })
for sec in sectors_out:
    assert len(sec["crises"]) == 4 and len(sec["statements"]) == 10, sec["name"]
    for c in sec["crises"]:
        assert (sec["name"], int(c["number"])) in details.CRISES, c
    for st in sec["statements"]:
        assert (sec["name"], st["title"]) in GUIDE or LIB_NO.get((sec["name"], st["title"])) in details.STATEMENTS, st


def and_list(names):
    names = list(names)
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


GAME = and_list(IN_GAME)
SPLIT = and_list(f"{SQUADS[n]} {n}" for n in IN_GAME)

CSS = """
table.stmt td:nth-child(2) { width: 56%; }
@page { size: A4; margin: 15mm 15mm 17mm; }
* { box-sizing: border-box; }
body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 9.8pt; line-height: 1.5; color: #1d1d1f; margin: 0; }
h1 { font-size: 28pt; line-height: 1.1; margin: 0 0 8px; color: #111; letter-spacing: -0.01em; }
h2 { font-size: 17pt; margin: 0 0 10px; padding-bottom: 4px; border-bottom: 2.5px solid #222; }
h3 { font-size: 11.6pt; margin: 14px 0 5px; break-after: avoid; }
h4 { font-size: 10pt; margin: 8px 0 3px; break-after: avoid; }
p { margin: 4px 0 8px; }
ul, ol { margin: 3px 0 6px 18px; padding: 0; }
li { margin: 2px 0; }
table { border-collapse: collapse; width: 100%; margin: 4px 0 10px; }
th, td { border: 1px solid #cfd2d6; padding: 5px 7px; vertical-align: top; text-align: left; }
th { background: #24272b; color: #fff; font-size: 8.8pt; font-weight: bold; }
tr { break-inside: avoid; }
.page { break-before: page; }
.keep { break-inside: avoid; break-after: avoid; }
thead { display: table-header-group; }
.muted { color: #5b6068; }
.small { font-size: 8.6pt; }
.note { background: #fff7e6; border-left: 4px solid #d48a00; padding: 7px 10px; margin: 10px 0; }
.box { border: 1px solid #d5d8dc; border-radius: 6px; padding: 9px 12px; background: #fafbfc; margin: 8px 0; }
.onscreen { position: relative; border: 2px solid var(--c); border-radius: 8px; background: var(--bg); padding: 12px 14px 11px; margin: 10px 0 12px; break-inside: avoid; }
.onscreen .tag { position: absolute; top: -9px; left: 12px; background: var(--c); color: #fff; font-size: 7.4pt; font-weight: bold;
  letter-spacing: 0.06em; text-transform: uppercase; padding: 1px 7px; border-radius: 4px; }
.onscreen .title { font-size: 12.5pt; font-weight: bold; margin: 2px 0 5px; }
.cover { height: 262mm; display: flex; flex-direction: column; }
.cover .kicker { font-size: 10pt; letter-spacing: 0.18em; text-transform: uppercase; color: #5b6068; margin-top: 38mm; }
.cover .sub { font-size: 13pt; color: #3a3f45; margin: 4px 0 22px; max-width: 150mm; }
.chips { display: flex; gap: 8px; margin: 6px 0 22px; align-items: center; }
.chips-sep { font-size: 8.6pt; color: #5b6068; margin-left: 8px; text-transform: uppercase; letter-spacing: 0.1em; }
.chip { color: #fff; font-weight: bold; font-size: 10pt; padding: 5px 12px; border-radius: 999px; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 8px 0 18px; }
.stat { border: 1px solid #d5d8dc; border-radius: 8px; padding: 10px; background: #fafbfc; }
.stat b { display: block; font-size: 20pt; line-height: 1.1; }
.stat span { font-size: 8.6pt; color: #3a3f45; }
.cover .foot { margin-top: auto; font-size: 8.6pt; color: #5b6068; border-top: 1px solid #d5d8dc; padding-top: 8px; }
.toc li { margin: 4px 0; }
.band { background: var(--c); color: #fff; border-radius: 8px; padding: 12px 16px; margin: 0 0 12px; }
.band .kick { font-size: 8.4pt; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.85; }
.band .name { font-size: 22pt; font-weight: bold; line-height: 1.15; }
.band .meta { font-size: 9pt; opacity: 0.92; margin-top: 3px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; }
.grid2 h4 { margin-top: 4px; color: var(--c); }
.crisis { border: 1px solid #d5d8dc; border-radius: 8px; margin: 10px 0 12px; break-inside: avoid; overflow: hidden; }
.crisis .head { display: flex; align-items: baseline; gap: 10px; padding: 6px 11px; background: #f3f4f6; border-bottom: 1px solid #d5d8dc; }
.crisis .num { font-size: 15pt; font-weight: bold; color: var(--cat); }
.crisis .cat { font-size: 8pt; font-weight: bold; letter-spacing: 0.1em; text-transform: uppercase; color: #fff; background: var(--cat);
  padding: 2px 7px; border-radius: 4px; }
.crisis .ttl { font-size: 12pt; font-weight: bold; }
.crisis .body { padding: 6px 11px 3px; font-size: 8.8pt; line-height: 1.36; }
.crisis ul { margin: 1px 0 3px 15px; }
.crisis li { margin: 1px 0; }
.crisis p { margin: 1px 0 4px; }
.crisis .text { background: var(--bg); border-left: 4px solid var(--c); padding: 6px 9px; margin: 0 0 5px; font-size: 9.5pt; }
.crisis .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
.lbl { font-size: 7.4pt; font-weight: bold; letter-spacing: 0.08em; text-transform: uppercase; color: #5b6068; margin: 5px 0 1px; }
.stmt td:first-child { width: 7%; font-weight: bold; color: var(--c); text-align: center; }
.stmt td:nth-child(2) { width: 36%; font-weight: bold; }
.rub td:last-child { width: 9%; text-align: center; font-weight: bold; }
.rub { break-inside: avoid; }
.secs { columns: 2; column-gap: 18px; margin: 4px 0 8px 18px; padding: 0; }
.kpi td:first-child { width: 28%; font-weight: bold; }
.spare li { margin: 3px 0; }
.glance { border: 2px solid var(--c); border-radius: 10px; padding: 10px 14px; margin: 8px 0 12px; background: var(--bg); break-inside: avoid; }
.glance h4 { margin: 0 0 4px; color: var(--c); font-size: 10.5pt; }
.glance table { margin: 2px 0 0; }
.glance td { border: none; border-bottom: 1px solid rgba(0,0,0,0.08); padding: 3px 6px; }
.glance td:first-child { width: 24%; font-weight: bold; color: #3a3f45; }
.who { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin: 6px 0 10px; }
.who .co { border: 1px solid #d5d8dc; border-top: 4px solid var(--c); border-radius: 8px; padding: 8px 10px; break-inside: avoid; background: #fff; }
.who .co .n { font-weight: bold; font-size: 11pt; }
.who .co .where { font-size: 7.6pt; letter-spacing: 0.08em; text-transform: uppercase; color: #5b6068; margin-left: 6px; }
.who .co p { margin: 3px 0; font-size: 9pt; }
.who .co .lesson { background: var(--bg); border-radius: 5px; padding: 4px 7px; font-size: 8.8pt; margin-top: 5px; }
.port { border: 2px solid var(--c); border-radius: 12px; margin: 10px 0 14px; overflow: hidden; break-inside: avoid; }
.port .top { background: var(--c); color: #fff; padding: 8px 14px; display: flex; align-items: baseline; gap: 12px; }
.port .top .nm { font-size: 15pt; font-weight: bold; }
.port .top .tk { font-family: "DejaVu Sans Mono", monospace; font-size: 10pt; background: rgba(255,255,255,0.22); padding: 1px 7px; border-radius: 4px; }
.port .top .tg { font-style: italic; opacity: 0.95; margin-left: auto; font-size: 10pt; }
.port .rows { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
.port .cell { padding: 6px 12px; border-top: 1px solid #e3e5e8; font-size: 9pt; }
.port .cell.wide { grid-column: span 2; }
.port .cell .lbl { margin-top: 0; }
.guide { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 8px 0; }
.guide .g { border: 1px solid #d5d8dc; border-left: 5px solid var(--gc); border-radius: 8px; padding: 9px 12px; background: #fafbfc; break-inside: avoid; }
.guide .g h4 { margin: 0 0 4px; color: var(--gc); font-size: 11pt; }
.profile { border: 1px solid #c9ced6; border-radius: 10px; padding: 10px 14px; background: #f6f8fb; margin: 8px 0 12px; break-inside: avoid; }
.gloss td:first-child { width: 24%; font-weight: bold; }
"""


def onscreen(sector, tag, title, body):
    c, bg, _ = COLOUR[sector]
    return (f'<div class="onscreen" style="--c:{c};--bg:{bg}"><span class="tag">{e(tag)}</span>'
            f'<div class="title">{e(title)}</div><div>{e(body).replace(chr(10) * 2, "<br><br>")}</div></div>')


def lower_first(text):
    """'A share of…' → 'a share of…' inside a list joined by semicolons; acronyms such as 'B2B' stay as they are."""
    word = text.split()[0].replace("-", "")
    return text[0].lower() + text[1:] if word.isalpha() and word[1:] == word[1:].lower() else text


def ul(items, cls=""):
    return f'<ul class="{cls}">' + "".join(f"<li>{e(x)}</li>" for x in items) + "</ul>"


def rubric(rows):
    return ('<table class="rub"><tr><th>Line</th><th>What earns points</th><th>Max</th></tr>'
            + "".join(f"<tr><td><b>{e(a)}</b></td><td>{e(b)}</td><td>{m}</td></tr>" for a, b, m in rows) + "</table>")


out = [f'<!doctype html><html><head><meta charset="utf-8"><title>PRIMUS · Problem statements and crises</title><style>{CSS}</style></head><body>']

# ───────────── Cover ─────────────
chips = "".join(f'<span class="chip" style="background:{COLOUR[s][0]}">{s}</span>' for s in IN_GAME) + (
    ('<span class="chips-sep">extra:</span>' + "".join(
        f'<span class="chip" style="background:#fff;color:{COLOUR[s][0]};border:2px solid {COLOUR[s][0]};padding:3px 10px">{s}</span>'
        for s in EXTRAS)) if EXTRAS else "")
n_all = len(sectors_out)
extra_note = (f" <b>{e(and_list(EXTRAS))}</b> {'is an extra sector' if len(EXTRAS) == 1 else 'are extra sectors'} with the same parts; "
              "their texts are marked <b>Card text</b>, because they are not in the files uploaded for the night "
              "(<span class=\"small\">seed/sectors/all</span> holds every sector).") if EXTRAS else ""
out.append(f"""
<section class="cover">
  <div class="kicker">PRIMUS 2026 · Market simulation · Product track</div>
  <h1>Problem statements<br>and crises</h1>
  <div class="sub">{e(GAME)}: every problem statement, crisis card and Round 3 problem in the game, in detail. What each one
  asks of the teams, what a strong answer covers, and how it is judged.</div>
  <div class="chips">{chips}</div>
  <div class="stats">
    <div class="stat"><b>{n_all}</b><span>Round 1 problem statements, one per sector</span></div>
    <div class="stat"><b>1</b><span>Round 1 consulting case, the same for every firm</span></div>
    <div class="stat"><b>{4 * n_all}</b><span>Round 2 crisis cards, four per sector, each with a twist</span></div>
    <div class="stat"><b>{10 * n_all}</b><span>Round 3 problem statements, ten per sector, each a client brief</span></div>
  </div>
  <div class="box"><b>How to read this book.</b> <b>{e(GAME)}</b> are the game's sectors. The coloured boxes are the cards
  themselves: the problem statements, the crisis cards and the client briefs, as the teams receive them.{extra_note} Everything
  around the cards is guidance for organisers, judges and mentors: what each card means, what a strong answer covers and what
  moves the market.</div>
  <div class="note"><b>Fairness.</b> {e(book.INTRO["fairness"])}</div>
  <div class="foot">PRIMUS 2026 · Problem statements and crises · {e(GAME)} · November 2026</div>
</section>""")

# ───────────── Contents and how the night uses them ─────────────
out.append("""
<section class="page">
  <h2>Contents</h2>
  <ol class="toc">
    <li>How the night uses the statements and crises</li>
    <li>Round 1 · The consulting case: ZestUp, the forbidden formula</li>
""" + "".join(f"<li>{e(sec['name'])}{'' if sec['in_game'] else ' (extra sector)'}: the problem statement, four crises with their twists, spare cards and ten Round 3 statements</li>" for sec in sectors_out) + """
    <li>Appendix A · How every answer is judged (the rubrics)</li>
    <li>Appendix B · Organiser checklist</li>
    <li>Appendix C · Glossary</li>
  </ol>
  <p class="small muted">Each sector section opens with the sector <b>at a glance</b>, then its <b>company portfolio</b>: the real companies
  shaping it, and three sample PRIMUS companies that show what a strong startup looks like.</p>
  <h2 style="margin-top:18px">1 · How the night uses them</h2>
  <p>PRIMUS has three tracks. <b>Product</b> teams build a startup inside their sector and run it as a listed company.
  <b>Consulting</b> teams are firms that companies hire for advice. <b>Finance</b> teams are funds that invest in the companies
  and trade their shares. At the squad draw the lottery gives every squad one of the """ + str(N) + """ sectors, in equal shares
  (""" + e(SPLIT) + """ for 50 squads), and the squad keeps that sector all night.</p>
  <table>
    <tr><th style="width:13%">Time</th><th style="width:17%">Round</th><th>What happens</th><th style="width:27%">What it moves</th></tr>
    <tr><td>21:00</td><td>Squad draw</td><td>Each squad's sector is drawn and its problem card is set.</td><td>Who competes with whom all night</td></tr>
    <tr><td>21:00–22:00</td><td>Round 1 · Foundation</td><td><b>Product</b> writes a PRD for a startup inside its sector's problem
      statement (800 words, 7 sections). <b>Consulting</b> writes a memo on the ZestUp case (500 words, 6 sections). <b>Finance</b> trades the practice market:
      $100,000 of practice money on live candlestick charts named after the Product teams.</td>
      <td>The PRD score sets the IPO price; the memo score sets the firm's opening reputation and a bonus; each fund's practice profit (up to $50,000) is added to its real cash</td></tr>
    <tr><td>by 22:30</td><td>Round 1</td><td><b>Consulting</b> makes Call 1: BUY or SELL on each of its two companies.
      <b>Finance</b> reads the PRDs and bids in the IPO (until 22:45).</td><td>$2,500 per correct call; the opening share register</td></tr>
    <tr><td>22:45 · 00:15 · 01:45 · 03:15</td><td>Round 2 · Pressure</td><td>Four crises. In crisis <i>k</i> every company gets
      its own sector's card number <i>k</i>: 1 Operations, 2 Market, 3 Trust, 4 Money.</td><td>Every price −5% at each reveal;
      then each plan's score moves its company's price</td></tr>
    <tr><td>04:45</td><td>Round 3 · Saturation</td><td>Funds receive fresh capital. Companies draft one of their sector's ten
      statements and write a solution with a hired firm (600 words, 6 sections).</td><td>The solution score moves the price,
      shared between companies on the same statement</td></tr>
    <tr><td>06:00 · 06:30 · 07:10</td><td>Close</td><td>Solutions due; the market closes; the awards.</td><td>Final rankings</td></tr>
  </table>
  <h3>One crisis, minute by minute</h3>
  <table>
    <tr><th style="width:13%">Minute</th><th>What happens</th></tr>
    <tr><td>0</td><td>The crisis cards are revealed, one to each company (its sector's card <i>k</i>). Every price falls 5% and trading pauses for 5 minutes.</td></tr>
    <tr><td>0–20</td><td><b>Hiring.</b> The Product team sends offers (cash, shares or both) to consulting firms; firms accept, counter or decline. One firm per company, at most two clients per firm. Open offers lapse at minute 20.</td></tr>
    <tr><td>20–65</td><td><b>Writing.</b> The Product team writes its crisis plan (500 words, 7 sections); the hired firm writes its advice memo to the client (500 words, 4 sections). Both close at minute 65. The fee, held in escrow, is paid to the firm if its memo is in, and refunded otherwise.</td></tr>
    <tr><td>65–80</td><td><b>Rating.</b> The client rates its firm from 1 to 5 stars (a missing rating counts as 3). Plans are public; scores stay sealed.</td></tr>
    <tr><td>80</td><td><b>Release.</b> The plan's score moves the company's price. The firm earns a reputation bonus of $500 × (memo score − 50) + $1,000 × (stars − 3).</td></tr>
    <tr><td>80–90</td><td><b>Last trading window</b> of the crisis. It opens only once the plan scores are released.</td></tr>
  </table>
  <h3>Round 3 in short</h3>
  <table class="kpi">
    <tr><td>The statements</td><td>Ten per sector, each open to at most 5 companies (room for 50 in every sector).</td></tr>
    <tr><td>The draft</td><td>The lowest score so far (the PRD and the Round 2 plans, averaged) picks first, 20 seconds each, and only from its own sector's statements. A company that does not pick gets the least-crowded open statement.</td></tr>
    <tr><td>Hiring</td><td>Firms post an asking fee; offers must be 5–20% of the company's cash; at most 3 counters; 2 clients per firm.</td></tr>
    <tr><td>Saturation</td><td>On each statement, companies are ranked by score: the 1st gets its full price rise, the 2nd ×0.75, the 3rd ×0.5, the 4th and 5th ×0.25. Price falls apply in full. A company alone on its statement gets its full rise.</td></tr>
  </table>
</section>
<section class="page">
  <h2>How to use this book</h2>
  <p>This book is the whole case of the night in one place. Read the part for your track first; everyone should read their
  sector's <b>at a glance</b> page and its <b>company portfolio</b> before the squad draw.</p>
  <div class="guide">
    <div class="g" style="--gc:#15803d"><h4>Product teams · you are the startup</h4><ul>
      <li>Read your sector's problem statement and the <b>sample companies</b>: they show the level of detail a strong PRD has.</li>
      <li>Pick one user, one problem, one number. Vague PRDs score low.</li>
      <li>In each crisis, read the <b>twist</b> and make the decision the card asks for: the judge looks for it.</li>
      <li>In Round 3, read the client brief: who it is for, the numbers, the catch, what winning looks like.</li></ul></div>
    <div class="g" style="--gc:#1d4ed8"><h4>Consulting teams · you are the advisers</h4><ul>
      <li>Read the <b>ZestUp case</b> (section 2) and do its numbers: your Round 1 memo sets your reputation for the night.</li>
      <li>Learn your likely clients' crisis cards: firms that understand the sector get hired and rated well.</li>
      <li>Advice must be specific to the client: what to do, in what order, by whom, with numbers.</li>
      <li>No memo, no fee: the escrow is paid only if your advice is in on time.</li></ul></div>
    <div class="g" style="--gc:#b45309"><h4>Finance teams · you are the investors</h4><ul>
      <li>Round 1: trade the <b>practice market</b>. Read the candles: hammers, engulfings and breakouts are planted, and most follow through.</li>
      <li>Read every sector's <b>What Finance teams should watch</b> table and the crisis cards: prices fall 5% at each reveal, then move with each plan's score.</li>
      <li>Strong plans recover; weak ones keep falling. Trade the gap.</li>
      <li>In Round 3, crowded statements share the price rise: watch the draft.</li></ul></div>
    <div class="g" style="--gc:#6d28d9"><h4>Judges, mentors and organisers</h4><ul>
      <li>Every card has <b>what a strong answer covers</b> and how it is judged (Appendix A).</li>
      <li>Spare cards are ready as mid-round surprises (one per sector section).</li>
      <li>The organiser checklist is Appendix B; the words of the game are in the glossary (Appendix C).</li>
      <li>All numbers on the cards are invented for the game and are the same for every company that receives a card.</li></ul></div>
  </div>
</section>""")

# ───────────── The consulting case ─────────────
Z = final.ZESTUP
out.append(f"""
<section class="page">
  <h2>2 · Round 1 · The consulting case: ZestUp</h2>
  <p>Every Consulting firm, whatever its squad's sector, writes a recommendation memo on this one case, by 22:00. Because the
  case is the same for everyone, the memo score is a fair first measure of each firm, and it sets the reputation companies
  see when they hire in Round 2.</p>
  <div class="profile"><h3 style="margin-top:0">Company profile · ZestUp</h3>
    <table class="kpi" style="margin:0">
      <tr><td>Who they are</td><td>{e(Z["profile"]["what"])}</td></tr>
      <tr><td>The flagship</td><td>{e(Z["profile"]["flagship"])}</td></tr>
      <tr><td>Where they stand</td><td>{e(Z["profile"]["position"])}</td></tr>
    </table></div>
  <div class="onscreen" style="--c:#334155;--bg:#f3f5f8"><span class="tag">The case</span>
    <div class="title">{e(Z["title"])}</div><div>{"<br><br>".join(e(x) for x in Z["story"])}</div></div>
  <div class="note"><b>The challenge.</b> {e(Z["challenge"])}</div>
  <h3>The four options on the table</h3>
  <table class="kpi"><tr><th>Option</th><th>The facts</th><th style="width:30%">Firms must</th></tr>
  {"".join(f"<tr><td>{e(a)}</td><td>{e(b)}</td><td>{e(c_)}</td></tr>" for a, b, c_ in Z["options"])}
  </table>
  <p><b>The memo (500 words) has six sections:</b> diagnosis · options and trade-offs · recommendation · the numbers · risks ·
  next steps. The judge scores them out of 25, 20, 20, 15, 10 and 10 (Appendix A).</p>
  <h3>What a strong memo does</h3>
  {ul(Z["strong"])}
  <div style="break-inside:avoid"><h3>The numbers, worked (for judges and mentors)</h3>
  <table class="kpi">{"".join(f"<tr><td>{e(a)}</td><td>{e(b)}</td></tr>" for a, b in Z["key"])}</table>
  <p class="small muted">ZestUp, Virex-7 and every figure in the case are invented for the game. The standard is what a strong
  student team can write in under an hour.</p></div>
</section>""")

# ───────────── The sectors ─────────────
for n, sec in enumerate(sectors_out, start=3):
    sector, in_game, prob = sec["name"], sec["in_game"], sec["problem"]
    ctx = context[SECTOR_KEY[sector]]
    c, bg, soft = COLOUR[sector]
    sector_crises, sector_statements = sec["crises"], sec["statements"]
    shown = "The card"
    article = "An" if sector in ("FMCG", "Energy", "Aviation") else "A"
    out.append(f'<section class="page" style="--c:{c};--bg:{bg}">')
    if in_game:
        out.append(f'<div class="band"><div class="kick">Section {n} · Sector</div><div class="name">{e(sector)}</div>'
                   f'<div class="meta">{e(prob["title"])} · problem card {e(prob["number"])} of {N} · about {SQUADS[sector]} squads of 50</div></div>')
    else:
        out.append(f'<div class="band"><div class="kick">Section {n} · Extra sector</div><div class="name">{e(sector)}</div>'
                   f'<div class="meta">{e(prob["title"])} · ready to play: seed/sectors/all, or pnpm sectors for any mix</div></div>')
    out.append(f'<p>{e(ctx["overview"])}</p>')
    pf = portfolios.PORTFOLIOS.get(sector)
    out.append(f'<div class="glance"><h4>{e(sector)} at a glance</h4><table>'
               f'<tr><td>Round 1 problem</td><td>{e(prob["title"])}</td></tr>'
               + "".join(f'<tr><td>Crisis {e(x["number"])} · {e(x["category"])}</td><td>{e(x["title"])}</td></tr>' for x in sector_crises)
               + f'<tr><td>Round 3</td><td>{len(sector_statements)} client briefs, at most 5 companies each</td></tr>'
               + (f'<tr><td>Sample companies</td><td>{e(", ".join(f"{x["name"]} ({x["ticker"]})" for x in pf["samples"]))}</td></tr>' if pf else "")
               + '</table></div>')
    out.append(f'<h3>Round 1 · The problem statement</h3>')
    out.append(onscreen(sector, f"Problem card {prob['number']}" if in_game else "Card text · extra sector", prob["title"], prob["body"]))
    if sector == "Aviation":
        fs = final.AVIATION_PROBLEM
        out.append(f'<div class="onscreen" style="--c:{c};--bg:{bg}"><span class="tag">Network fact sheet</span>'
                   f'<div class="grid2" style="gap:0 18px">{ul(fs["fact_sheet"][:4])}{ul(fs["fact_sheet"][4:])}</div>'
                   f'<p style="margin:4px 0 0"><i>{e(fs["fact_note"])}</i></p></div>'
                   f'<div class="box"><div class="lbl" style="margin-top:0">Rules for this sector</div>{ul(fs["rules"])}'
                   f'<p class="small muted" style="margin:2px 0 0">Run by the organisers on the night (the shared map is on the projector or a board).</p></div>')
    out.append('<p class="small muted">Every Product team in this sector invents its own startup inside this statement and '
               'describes it in its PRD (800 words, 7 sections: problem and target user, proposed solution, core features and '
               'MVP scope, success metrics, business model, competitive edge, key risks).</p>')
    out.append('<h3>Opportunity areas</h3><div class="grid2">')
    for title, items in ctx["areas"]:
        out.append(f'<div><h4>{e(title)}</h4>{ul(items)}</div>')
    out.append('</div>')
    out.append('<h3>Real-world challenges</h3><table><tr><th style="width:28%">Challenge</th><th>Why it matters</th></tr>'
               + "".join(f"<tr><td><b>{e(a)}</b></td><td>{e(b)}</td></tr>" for a, b in ctx["challenges"]) + "</table>")
    if pf:
        out.append('<h3>Company portfolio · who is shaping this sector</h3><div class="who">'
                   + "".join(f'<div class="co"><span class="n">{e(n_)}</span><span class="where">{e(w)}</span>'
                             f'<p>{e(what)}</p><p><b>Makes money from:</b> {e(money_)}</p><div class="lesson"><b>The lesson:</b> {e(lesson)}</div></div>'
                             for n_, w, what, money_, lesson in pf["real"])
                   + '</div><p class="small muted">Real companies, described in general terms from public information, for inspiration only: '
                   'teams must not copy them, and the judge scores the team\'s own plan.</p>')
    else:
        out.append('<h3>Startups for inspiration</h3>'
                   + ul([f"{a}: {b}" for a, b in ctx["inspiration"]])
                   + '<p class="small muted">Named for inspiration only: teams must not copy them, and the judge scores the team\'s own plan.</p>')
    if pf:
        out.append(f'<h3 style="break-before:page">Company portfolio · three sample PRIMUS companies</h3>'
                   f'<p>What a strong {e(sector)} startup looks like on paper: one user, one sharp problem, a small first version, '
                   f'a clear way to make money and targets with numbers. These are invented examples, not answers: every team builds its own.</p>')
        for x in pf["samples"]:
            out.append(f'<div class="port"><div class="top"><span class="nm">{e(x["name"])}</span><span class="tk">{e(x["ticker"])}</span>'
                       f'<span class="tg">{e(x["tagline"])}</span></div><div class="rows">'
                       f'<div class="cell wide"><div class="lbl">The problem</div>{e(x["problem"])}</div>'
                       f'<div class="cell wide"><div class="lbl">The product (first version)</div>{e(x["product"])}</div>'
                       f'<div class="cell"><div class="lbl">The customer</div>{e(x["customer"])}</div>'
                       f'<div class="cell"><div class="lbl">How it makes money</div>{e(x["model"])}</div>'
                       f'<div class="cell wide"><div class="lbl">Targets</div><b>{e(x["targets"])}</b></div>'
                       f'<div class="cell"><div class="lbl">The edge</div>{e(x["edge"])}</div>'
                       f'<div class="cell"><div class="lbl">The biggest risk, and the answer</div>{e(x["risk"])}</div>'
                       f'</div></div>')
        out.append('<p class="small muted">The companies, tickers and numbers are invented for the game.</p>')
    else:
        cname, cidea, crev = ctx["concept"]
        out.append(f'<div class="box"><b>An illustrative concept: {e(cname)}.</b> {e(cidea)}<br>'
                   f'<span class="small"><b>How it could make money:</b> {e("; ".join([crev[0]] + [lower_first(x) for x in crev[1:]]))}.</span></div>')
    out.append('<h3>What a strong PRD shows in this sector</h3>' + ul(ctx["prd"]))

    r2_when = "" if in_game else f"If {e(sector)} is played, "
    r2_intro = (f'<h3>Round 2 · The four crisis cards</h3>'
                f'<p>{r2_when}{"I" if in_game else "i"}n crisis <i>k</i>, every {e(sector)} company receives card <i>k</i> below, so all of them face the same '
                f'numbers and can be compared fairly. The plan (500 words) is due 65 minutes after the reveal.</p>')
    for i, x in enumerate(sector_crises):
        k = int(x["number"])
        d = details.CRISES[(sector, k)]
        cat = CATEGORY[x["category"]]
        block = (f'<div class="crisis" style="--cat:{cat}">'
                   f'<div class="head"><span class="num">{k}</span><span class="cat">{e(x["category"])}</span><span class="ttl">{e(x["title"])}</span></div>'
                   f'<div class="body"><div class="lbl">{shown}</div><div class="text">{e(x["body"]).replace(chr(10)*2, "<br><br>")}</div>'
                   f'<div class="cols"><div><div class="lbl">On the card</div>{ul(d["on_card"])}'
                   f'<div class="lbl">What it does to the company</div><p>{e(d["impact"])}</p></div>'
                   f'<div><div class="lbl">A strong crisis plan</div>{ul(d["plan"])}</div></div>'
                   f'<div class="cols"><div><div class="lbl">The hired firm\'s advice should</div><p>{e(d["advice"])}</p></div>'
                   f'<div><div class="lbl">What funds will watch</div><p>{e(d["watch"])}</p></div></div>'
                   f'</div></div>')
        out.append(f'<div style="break-inside:avoid">{r2_intro}{block}</div>' if i == 0 else block)
    out.append('<h3>Spare cards</h3><p class="small">Not loaded in the game. Use one to replace a card before the draw, in a '
               'rehearsal, or as a mid-round surprise announced in a bulletin.</p>' + ul(ctx["spare"], "spare"))

    out.append(f'<div class="keep"><h3>Round 3 · The ten problem statements</h3>'
               f'<p>Each statement takes at most 5 companies. {article} {e(sector)} company drafts only from this list, and writes its '
               f'solution (600 words, 6 sections: our solution, why it fits the statement, how we stand apart, how we will '
               f'build it, business impact, risks) with the firm it hires. {"The game shows" if in_game else "Once uploaded, the game shows"} each statement as its title and a client brief: '
               f'who it is for, the numbers, the catch and what winning looks like.{"" if in_game else " The numbers are those of seed/sectors/all; a mix made with pnpm sectors numbers them again."}</p></div>')
    out.append(f'<table class="stmt"><tr><th>#</th><th>Statement</th><th>A strong solution shows</th></tr>')
    for s in sector_statements:
        brief = "".join(f'<div class="small" style="font-weight:normal;margin-top:2px"><b>{e(line.split(": ", 1)[0])}:</b> {e(line.split(": ", 1)[1])}</div>'
                        for line in s.get("body", "").split("\n") if ": " in line and not line.startswith(sector))
        out.append(f'<tr><td>{e(s["number"])}</td><td><b>{e(s["title"])}</b>{brief}<div class="small muted" style="font-weight:normal">'
                   f'Up to {e(s["cap"])} companies</div></td><td>{e(GUIDE.get((sector, s["title"])) or details.STATEMENTS[LIB_NO[(sector, s["title"])]])}</td></tr>')
    out.append('</table>')
    out.append('<h3>What Finance teams should watch in this sector</h3><table><tr><th style="width:30%">Signal</th><th>Why</th></tr>'
               + "".join(f"<tr><td><b>{e(a)}</b></td><td>{e(b)}</td></tr>" for a, b in ctx["finance"]) + "</table>")
    out.append('</section>')

# ───────────── Appendix A: the rubrics ─────────────
out.append('<section class="page"><h2>Appendix A · How every answer is judged</h2>'
           '<p>The AI judge scores each submission three times against these rubrics (five times if the three differ by more '
           'than 10 points) and keeps the median. Names are hidden, so every team is judged by the same standard. A score is out of 100.</p>')
out.append('<h3>Round 1 · The PRD (Product, 800 words)</h3>' + rubric([
    ("Problem", "A specific problem, the user who has it, how many people have it and what it costs them today", 20),
    ("Solution", "A solution that clearly fixes that problem, with a small first version (MVP) whose core features are named and in scope", 20),
    ("Metrics", "Measurable signs of success, with targets and a time frame, that show whether the product works", 15),
    ("Business model", "Who pays, how much and how often, and whether that revenue can cover the costs", 15),
    ("Feasibility", "Whether a small team could build and run it with its seed money, why it beats the alternatives, and the main risks with a plan for each", 15),
    ("Clarity", "A PRD that is well organised, specific and easy to act on, with no filler", 15),
]))
out.append('<h3>Round 1 · The consulting memo (Consulting, 500 words)</h3>' + rubric([
    ("Diagnosis", "The real problem, why it matters and what is at stake for ZestUp, using the case's facts", 25),
    ("Options", "Two or more real options, with what each one costs, gains and risks", 20),
    ("Recommendation", "One clear choice that follows from the diagnosis and options, with the reason", 20),
    ("Numbers", "Costs, revenue at risk, cash and timing that are correct and add up", 15),
    ("Risks", "What could go wrong with the recommendation and how to reduce it", 10),
    ("Next steps", "Concrete actions for this week, with who does them and by when", 10),
]))
out.append('<h3>Round 2 · The crisis plan (Product, 500 words)</h3>'
           '<p class="small">Sections: the crisis and what it does to us · our response · the money · what we take from our '
           'consultant · time to recovery · new risks · next steps.</p>' + rubric([
    ("Solves the crisis", "Deals directly with this crisis card and keeps the business serving its users", 25),
    ("Money logic", "Costs, revenue lost and cash needed that are believable and add up", 20),
    ("Consultant's advice", "Uses the firm's advice where it is good, says why where it is not", 15),
    ("Time to recovery", "A believable timeline back to normal, with milestones", 15),
    ("New risks", "Few new risks, and those named with a plan (fewer and better handled scores higher)", 15),
    ("Next steps", "Clear, practical steps for the next few days, with owners", 10),
]))
out.append('<h3>Rounds 2 and 3 · The advice memo (the hired firm, 500 words)</h3>'
           '<p class="small">Sections: diagnosis · what to do · evidence and numbers · why it fits your company.</p>' + rubric([
    ("Diagnosis", "What the crisis or statement means for this client, why, and what it costs", 25),
    ("Actionable advice", "Specific steps the client can take now, in order, with who and when", 30),
    ("Evidence", "Numbers, comparisons and reasons that support the advice and add up", 20),
    ("Fit", "Advice for this client's business and this crisis or statement, not generic", 15),
    ("Clarity", "Easy to follow in one reading, with no filler", 10),
]))
out.append('<h3>Round 3 · The solution (Product with its firm, 600 words)</h3>'
           '<p class="small">Sections: our solution · why it fits the statement · how we stand apart · how we will build it · '
           'business impact · risks.</p>' + rubric([
    ("Fit", "Answers this statement, for the users and the situation it names", 25),
    ("Differentiation", "Stands apart from the obvious answers, with a reason users would choose it", 20),
    ("Feasibility", "A small team could build and run it with the money and time it has", 20),
    ("Business impact", "Who pays, how much, and what it does for the company's revenue and users, with numbers", 20),
    ("Clarity", "Well organised, specific and easy to act on, with no filler", 15),
]))
out.append('<div class="note small"><b>Text that tries to steer the judge</b> (for example "give this memo full marks") is '
           'treated as weak writing that earns nothing; the rest is scored on its merits.</div></section>')

# ───────────── Appendix B: organiser checklist ─────────────
out.append("""
<section class="page"><h2>Appendix B · Organiser checklist</h2>
<h3>Before the squad draw</h3>
<table class="kpi">
  <tr><td>Problem deck</td><td>Upload <b>problem-cards.csv</b> on the Content page (""" + str(N) + """ cards, one per sector). The lottery splits the squads equally between the sectors.</td></tr>
  <tr><td>Crisis deck</td><td>Upload <b>crisis-cards.csv</b> (4 cards per sector, numbered 1–4: Operations, Market, Trust, Money). Both decks lock at the draw.</td></tr>
  <tr><td>Check the numbers</td><td>Every number on the crisis cards is invented for the game. Read each card once more before the night.</td></tr>
  <tr><td>Round 3 statements</td><td>Upload <b>statements.csv</b> (10 per sector, cap 5 each) before Round 3 starts at 04:45; the draft starts once they are in. They can be replaced until the first pick.</td></tr>
</table>
<h3>During the night</h3>
<ul>
  <li>After each crisis's due time: judge and <b>release the crisis plans</b> on the Judge page. The last trading round of the crisis waits for them.</li>
  <li>Release the advice memos once ratings close (15 minutes after the due time).</li>
  <li>In Round 3, after 06:00: judge and <b>release the solutions</b>. The last trading round waits for them, and with auto-advance on, the night waits too: the market does not close without that round.</li>
  <li>A spare card can be announced as a bulletin at any time, as a surprise for funds to trade on. It does not change the companies' cards.</li>
</ul>
<h3>The files</h3>
<table>
  <tr><th style="width:30%">File</th><th>What it holds</th></tr>
  <tr><td>seed/sectors/problem-cards.csv</td><td>The Round 1 problem statements, one per sector (""" + e(GAME) + """)</td></tr>
  <tr><td>seed/sectors/crisis-cards.csv</td><td>The Round 2 crisis cards, four per sector</td></tr>
  <tr><td>seed/sectors/statements.csv</td><td>The Round 3 statements, ten per sector</td></tr>
  <tr><td>prompts/MEMO.md</td><td>The consulting case and the memo rubric the AI judge reads</td></tr>
  <tr><td>seed/sectors/all/</td><td>The same three files with every sector in the library (FMCG, Aviation, Luxury, Energy, Fintech)</td></tr>
  <tr><td>pnpm sectors --pick FMCG,Aviation,Luxury</td><td>Writes the three files for any mix of 2 to 6 sectors into out/sectors/…, checked with the Content page's own rules</td></tr>
</table>
</section>""")

out.append("""
<section class="page"><h2>Appendix C · Glossary</h2>
<table class="gloss">
  <tr><th>Word</th><th>What it means in PRIMUS</th></tr>
  <tr><td>Squad</td><td>Three teams drawn together: one Product, one Consulting, one Finance. A Finance team never trades its own squad's company.</td></tr>
  <tr><td>PRD</td><td>Product requirements document: the startup's plan in 7 sections and 800 words. Its score sets the IPO price.</td></tr>
  <tr><td>Ticker</td><td>A company's 3–4 letter market code, chosen by the Product team (for example FRLP).</td></tr>
  <tr><td>IPO</td><td>Initial public offering: funds bid for each company's first shares at its IPO price.</td></tr>
  <tr><td>Trading round</td><td>A 15-minute window for orders. Every order fills at the round's new price; the price moves with the net shares bought or sold (at most ±10%).</td></tr>
  <tr><td>BUY / SELL</td><td>Buy shares; sell shares you own.</td></tr>
  <tr><td>SHORT / COVER</td><td>Sell shares you do not own, betting the price will fall (150% of the value is locked as collateral); buy them back to close.</td></tr>
  <tr><td>Practice market</td><td>Round 1 for Finance: $100,000 of practice money on scripted candlestick charts. Profit up to $50,000 is added to the real fund; a loss costs nothing.</td></tr>
  <tr><td>Candlestick</td><td>A bar showing a price's open, high, low and close over a period: green when it closed higher, red when lower.</td></tr>
  <tr><td>Crisis card</td><td>The problem each company receives in each of the four crises: its own sector's card number 1 to 4. Every price falls 5% at the reveal.</td></tr>
  <tr><td>Twist</td><td>The second blow at the end of each crisis card, with the decision the plan must make.</td></tr>
  <tr><td>Escrow</td><td>The hiring fee, held by the exchange until the firm's advice memo is in; refunded to the client if it is not.</td></tr>
  <tr><td>Stars</td><td>The client's 1–5 rating of its firm after each crisis (a missing rating counts as 3).</td></tr>
  <tr><td>Draft</td><td>Round 3: companies pick a problem statement in turn, lowest score first, 20 seconds each.</td></tr>
  <tr><td>Saturation</td><td>Companies sharing a statement share its price rise: 1st full, 2nd ×0.75, 3rd ×0.5, 4th and 5th ×0.25.</td></tr>
  <tr><td>Median of three</td><td>Every answer is judged three times by the AI judge; the middle score counts (five times if the three differ by more than 10 points).</td></tr>
  <tr><td>Sealed / released</td><td>Scores are sealed (hidden) until the organisers release them; the release moves the prices.</td></tr>
</table>
</section>""")
out.append("</body></html>")
out = [re.sub(r'(<table[^>]*>)(<tr>(?:<th[^>]*>.*?</th>)+</tr>)', r'\1<thead>\2</thead>', x, flags=re.S) for x in out]
# A rubric's heading, its sections line and its table stay on one page.
out = [re.sub(r'(<h3>[^<]*</h3>(?:<p class="small">.*?</p>)?<table class="rub">.*?</table>)', r'<div style="break-inside:avoid">\1</div>', x, flags=re.S) for x in out]
OUT.write_text("\n".join(out), encoding="utf-8")
print(f"wrote {OUT} ({sum(len(x) for x in out):,} chars)")
