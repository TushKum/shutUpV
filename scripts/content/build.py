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
e = html.escape

problems = list(csv.DictReader(open(ROOT / "seed/sectors/problem-cards.csv", encoding="utf-8")))
crises = list(csv.DictReader(open(ROOT / "seed/sectors/crisis-cards.csv", encoding="utf-8")))
statements = list(csv.DictReader(open(ROOT / "seed/sectors/statements.csv", encoding="utf-8")))
memo_md = (ROOT / "prompts/MEMO.md").read_text(encoding="utf-8")
case = re.search(r"## The case\n\n(.+?)\n\n## ", memo_md, re.S).group(1).strip()

SECTOR_KEY = {"Luxury": "LUXURY", "FMCG": "FMCG", "Energy": "ENERGY", "Aviation": "AVIATION", "Fintech": "FINTECH"}
context = {s["name"]: s for s in book.SECTORS}
COLOUR = {"Luxury": ("#6d28d9", "#f4effe", "#e6dbfb"), "FMCG": ("#15803d", "#edf8f1", "#d3eedd"), "Energy": ("#b45309", "#fdf6e8", "#f6e4c2"),
          "Aviation": ("#0369a1", "#eaf4fb", "#cfe6f5"), "Fintech": ("#be185d", "#fdf0f6", "#f7d6e5")}
CATEGORY = {"Operations": "#c2410c", "Market": "#1d4ed8", "Trust": "#be123c", "Money": "#4d7c0f"}
all_crises = list(csv.DictReader(open(ROOT / "seed/sectors/all/crisis-cards.csv", encoding="utf-8")))
all_statements = list(csv.DictReader(open(ROOT / "seed/sectors/all/statements.csv", encoding="utf-8")))
# The guidance for a Round 3 statement is kept by its number in the five-sector library; a game's files number them
# again, so it is found by title.
LIB_NO = {(x["sector"], x["title"]): int(x["number"]) for x in all_statements}

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
        assert LIB_NO.get((sec["name"], st["title"])) in details.STATEMENTS, st


def and_list(names):
    names = list(names)
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


GAME = and_list(IN_GAME)
SPLIT = and_list(f"{SQUADS[n]} {n}" for n in IN_GAME)

CSS = """
table.stmt td:nth-child(2) { width: 56%; }
@page { size: A4; margin: 15mm 15mm 17mm; }
* { box-sizing: border-box; }
body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 9.3pt; line-height: 1.42; color: #1d1d1f; margin: 0; }
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
  <div class="box"><b>How to read this book.</b> <b>{e(GAME)}</b> are the game's sectors: text marked <b>On screen</b> is
  exactly what teams see (it comes from the files the organisers upload: <span class="small">seed/sectors/problem-cards.csv,
  crisis-cards.csv and statements.csv</span>).{extra_note} Everything around the cards is guidance for organisers, judges
  and mentors: what each card means, what a strong answer covers and what moves the market.</div>
  <div class="note"><b>Fairness.</b> {e(book.INTRO["fairness"])}</div>
  <div class="foot">PRIMUS 2026 · Problem statements and crises · {e(GAME)} · November 2026</div>
</section>""")

# ───────────── Contents and how the night uses them ─────────────
out.append("""
<section class="page">
  <h2>Contents</h2>
  <ol class="toc">
    <li>How the night uses the statements and crises</li>
    <li>Round 1 · The consulting case: ElevenLabs, winning India's voices</li>
""" + "".join(f"<li>{e(sec['name'])}{'' if sec['in_game'] else ' (extra sector)'}: the problem statement, four crises with their twists, spare cards and ten Round 3 statements</li>" for sec in sectors_out) + """
    <li>Appendix A · How every answer is judged (the rubrics)</li>
    <li>Appendix B · Organiser checklist</li>
  </ol>
  <h2 style="margin-top:18px">1 · How the night uses them</h2>
  <p>PRIMUS has three tracks. <b>Product</b> teams build a startup inside their sector and run it as a listed company.
  <b>Consulting</b> teams are firms that companies hire for advice. <b>Finance</b> teams are funds that invest in the companies
  and trade their shares. At the squad draw the lottery gives every squad one of the """ + str(N) + """ sectors, in equal shares
  (""" + e(SPLIT) + """ for 50 squads), and the squad keeps that sector all night.</p>
  <table>
    <tr><th style="width:13%">Time</th><th style="width:17%">Round</th><th>What happens</th><th style="width:27%">What it moves</th></tr>
    <tr><td>21:00</td><td>Squad draw</td><td>Each squad's sector is drawn and its problem card is set.</td><td>Who competes with whom all night</td></tr>
    <tr><td>21:00–22:00</td><td>Round 1 · Foundation</td><td><b>Product</b> writes a PRD for a startup inside its sector's problem
      statement (800 words, 7 sections). <b>Consulting</b> writes a memo on the ElevenLabs case (500 words, 6 sections).</td>
      <td>The PRD score sets the IPO price; the memo score sets the firm's opening reputation and a bonus</td></tr>
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
</section>""")

# ───────────── The consulting case ─────────────
out.append(f"""
<section class="page">
  <h2>2 · Round 1 · The consulting case: ElevenLabs</h2>
  <p>Every Consulting firm, whatever its squad's sector, writes a recommendation memo on this one case, by 22:00. Because the
  case is the same for everyone, the memo score is a fair first measure of each firm, and it sets the reputation companies
  see when they hire in Round 2.</p>
  <div class="onscreen" style="--c:#334155;--bg:#f3f5f8"><span class="tag">On screen · the case</span>
    <div class="title">ElevenLabs: winning India's voices</div><div>{e(case).replace(chr(10) * 2, "<br><br>")}</div></div>
  <h3>The facts at a glance</h3>
  <table class="kpi">
    <tr><td>The company</td><td>ElevenLabs, the AI voice company: text to speech, dubbing into other languages, voice agents that answer calls.</td></tr>
    <tr><td>India so far</td><td>Hindi and eight other Indian languages launched six months ago; ₹8 crore a year of revenue, mostly from 300 business customers.</td></tr>
    <tr><td>Individuals</td><td>4 lakh signed up, but only 1.2% pay (4% in other markets): dollar prices feel expensive and a local rival is free with ads.</td></tr>
    <tr><td>Budget and target</td><td>A team of 25 with ₹20 crore to spend this year; the board wants ₹30 crore a year from India within 12 months, or India is scaled back.</td></tr>
    <tr><td>Offer A · ed-tech</td><td>₹6 crore a year to dub 10,000 hours of lessons into 6 languages, if ElevenLabs serves no other ed-tech company and keeps all data in India (education is 40% of today's India revenue).</td></tr>
    <tr><td>Offer B · telecom</td><td>₹12 crore a year guaranteed to offer a basic voice plan to 5 crore subscribers, under the telecom's own name.</td></tr>
    <tr><td>Offer C · price cut</td><td>Indian plans at ₹199 a month, in the hope that many more individuals pay.</td></tr>
    <tr><td>Trust</td><td>A state election in four months; the press asks how cloned voices of politicians will be stopped; rules on labelling AI voices are being drafted.</td></tr>
    <tr><td>Deadline</td><td>One recommendation by Friday, including how ElevenLabs handles voice cloning.</td></tr>
  </table>
  <p class="small muted">The case is hypothetical: the numbers and offers are invented for the game and are not ElevenLabs' real figures or plans.</p>
  <p><b>The memo (500 words) has six sections:</b> diagnosis · options and trade-offs · recommendation · the numbers · risks ·
  next steps. The judge scores them out of 25, 20, 20, 15, 10 and 10 (Appendix A).</p>
  <h3>What a strong memo does</h3>
  <ul>
    <li><b>Diagnosis:</b> names the gap (₹8 crore today against ₹30 crore in 12 months) and the root cause: a product priced and
      branded for other markets, with trust in AI voices at risk in an election season.</li>
    <li><b>Options:</b> works out what each offer is worth and costs: A brings ₹6 crore but closes the rest of education
      (40% of today's revenue); B brings ₹12 crore guaranteed but hides the brand and the users; C's value depends on how many more
      individuals pay (at ₹199 a month, every 1% of 4 lakh users paying is about ₹96 lakh a year).</li>
    <li><b>Recommendation:</b> one clear path, possibly a combination, that can plausibly reach ₹30 crore within ₹20 crore, and
      says what it gives up and why.</li>
    <li><b>Voice cloning:</b> a concrete safeguard before the election (consent checks, labels or watermarks, blocking
      politicians' voices, a fast takedown) and how it fits the coming rules.</li>
    <li><b>Numbers, risks and next steps:</b> the path to the target month by month, a plan for each main risk, and this
      week's actions with owners and dates.</li>
  </ul>
  <p class="muted small">The standard is what a strong student team can write in under an hour.</p>
</section>""")

# ───────────── The sectors ─────────────
for n, sec in enumerate(sectors_out, start=3):
    sector, in_game, prob = sec["name"], sec["in_game"], sec["problem"]
    ctx = context[SECTOR_KEY[sector]]
    c, bg, soft = COLOUR[sector]
    sector_crises, sector_statements = sec["crises"], sec["statements"]
    shown = "On screen" if in_game else "Card text"
    article = "An" if sector in ("FMCG", "Energy", "Aviation") else "A"
    out.append(f'<section class="page" style="--c:{c};--bg:{bg}">')
    if in_game:
        out.append(f'<div class="band"><div class="kick">Section {n} · Sector</div><div class="name">{e(sector)}</div>'
                   f'<div class="meta">{e(prob["title"])} · problem card {e(prob["number"])} of {N} · about {SQUADS[sector]} squads of 50</div></div>')
    else:
        out.append(f'<div class="band"><div class="kick">Section {n} · Extra sector</div><div class="name">{e(sector)}</div>'
                   f'<div class="meta">{e(prob["title"])} · ready to play: seed/sectors/all, or pnpm sectors for any mix</div></div>')
    out.append(f'<p>{e(ctx["overview"])}</p>')
    out.append(f'<h3>Round 1 · The problem statement</h3>')
    out.append(onscreen(sector, f"On screen · problem card {prob['number']}" if in_game else "Card text · extra sector", prob["title"], prob["body"]))
    out.append('<p class="small muted">Every Product team in this sector invents its own startup inside this statement and '
               'describes it in its PRD (800 words, 7 sections: problem and target user, proposed solution, core features and '
               'MVP scope, success metrics, business model, competitive edge, key risks).</p>')
    out.append('<h3>Opportunity areas</h3><div class="grid2">')
    for title, items in ctx["areas"]:
        out.append(f'<div><h4>{e(title)}</h4>{ul(items)}</div>')
    out.append('</div>')
    out.append('<h3>Real-world challenges</h3><table><tr><th style="width:28%">Challenge</th><th>Why it matters</th></tr>'
               + "".join(f"<tr><td><b>{e(a)}</b></td><td>{e(b)}</td></tr>" for a, b in ctx["challenges"]) + "</table>")
    out.append('<h3>Startups for inspiration</h3>'
               + ul([f"{a}: {b}" for a, b in ctx["inspiration"]])
               + '<p class="small muted">Named for inspiration only: teams must not copy them, and the judge scores the team\'s own plan.</p>')
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
    out.append(f'<table class="stmt"><tr><th>#</th><th>{"Statement (on screen)" if in_game else "Statement"}</th><th>A strong solution shows</th></tr>')
    for s in sector_statements:
        brief = "".join(f'<div class="small" style="font-weight:normal;margin-top:2px"><b>{e(line.split(": ", 1)[0])}:</b> {e(line.split(": ", 1)[1])}</div>'
                        for line in s.get("body", "").split("\n") if ": " in line and not line.startswith(sector))
        out.append(f'<tr><td>{e(s["number"])}</td><td><b>{e(s["title"])}</b>{brief}<div class="small muted" style="font-weight:normal">'
                   f'Up to {e(s["cap"])} companies</div></td><td>{e(details.STATEMENTS[LIB_NO[(sector, s["title"])]])}</td></tr>')
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
    ("Diagnosis", "The real problem, why it matters and what is at stake for ElevenLabs in India, using the case's facts", 25),
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
  <tr><td>prompts/MEMO.md</td><td>The ElevenLabs case and the memo rubric</td></tr>
  <tr><td>seed/sectors/all/</td><td>The same three files with every sector in the library (FMCG, Aviation, Luxury, Energy, Fintech)</td></tr>
  <tr><td>pnpm sectors --pick FMCG,Aviation,Luxury</td><td>Writes the three files for any mix of 2 to 6 sectors into out/sectors/…, checked with the Content page's own rules</td></tr>
</table>
</section>""")

out.append("</body></html>")
out = [re.sub(r'(<table[^>]*>)(<tr>(?:<th[^>]*>.*?</th>)+</tr>)', r'\1<thead>\2</thead>', x, flags=re.S) for x in out]
# A rubric's heading, its sections line and its table stay on one page.
out = [re.sub(r'(<h3>[^<]*</h3>(?:<p class="small">.*?</p>)?<table class="rub">.*?</table>)', r'<div style="break-inside:avoid">\1</div>', x, flags=re.S) for x in out]
OUT.write_text("\n".join(out), encoding="utf-8")
print(f"wrote {OUT} ({sum(len(x) for x in out):,} chars)")
