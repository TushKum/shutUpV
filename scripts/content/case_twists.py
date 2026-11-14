# The richer PRIMUS case: a twist on every crisis card and a client brief behind every Round 3 statement.
# Writes seed/sectors/all/crisis-cards.csv and statements.csv (bodies only; titles, numbers and caps unchanged).
# Then: pnpm sectors --pick Luxury,FMCG,Energy --out seed/sectors   (the three-sector files)
# Every number here is invented for the game.

import csv, io, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIB = ROOT / "seed/sectors/all"

# (sector, number) -> (the twist, the decision the plan must make)
TWISTS = {
    ("Luxury", 1): ("The hackers email 300 of your top clients offering to delete their data for a fee, and two of them ask you to pay it.",
                    "Pay, refuse, or call the police, and what you say to the 300 within 24 hours."),
    ("Luxury", 2): ("The rival offers your three best artisans double pay to design for it. One has already said yes.",
                    "Match the offer, let them go, or partner with the rival, with the cost of each."),
    ("Luxury", 3): ("A celebrity posts that her bag from you is a fake. It is genuine, but the post has 2 million likes.",
                    "Prove it publicly or settle it privately, and how you protect every other client's trust."),
    ("Luxury", 4): ("Your largest investor asks you to cut prices 20% to keep sales up. Your brand team says that would end the brand.",
                    "Discount, hold prices and cut costs, or launch something cheaper under another name. Show the runway."),
    ("FMCG", 1): ("The heatwave is forecast to last 10 more days, and a rival offers to rent you its cold storage at 3× the normal rate.",
                  "Rent it, ration what you sell, or pause the hottest cities, and the cost of each for the 10 days."),
    ("FMCG", 2): ("The same giant offers to buy your company at your current price. Your investors are split.",
                  "Sell, partner, or fight, with what each means for customers and the share price."),
    ("FMCG", 3): ("You find that a second supplier may also be faking data, but checking it takes 6 weeks.",
                  "Say so now, or wait until you are sure. Who is told, and when."),
    ("FMCG", 4): ("Your biggest retailer says it will delist you if your price goes up by more than 5%.",
                  "Raise prices and risk the retailer, shrink packs, or absorb the cost. Show the margin and cash under your choice."),
    ("Energy", 1): ("A second blackout is likely within the week, and a minister blames 'private operators' on live TV.",
                    "Who you protect first (hospitals, paying customers, or the grid operator), and what you tell the public."),
    ("Energy", 2): ("An importer offers to supply you at their low price if you put your brand on their hardware.",
                    "Rebrand imports, cut your own costs, or compete on service and warranty. Show the margin of each."),
    ("Energy", 3): ("The regulator gives you 72 hours to share your safety data, and your own data shows one near-miss you never reported.",
                    "Disclose the near-miss or not, and how you rebuild trust with customers who are scared."),
    ("Energy", 4): ("A state government offers its own subsidy, but only if you build a factory in that state within 2 years.",
                    "Take the deal, change the business model, or sell to customers who do not need the subsidy. Show the payback."),
    ("Aviation", 1): ("Airlines blame your product for slowing their recovery, although the outage was not yours. A news channel repeats it.",
                      "Prove it was not you, or help first and argue later, and what you change so it cannot happen again."),
    ("Aviation", 2): ("The airline offers you a white-label contract: your product, their brand, a fixed fee, and no access to your users.",
                      "Sign it, refuse it, or win the airline's rivals, with the revenue of each over a year."),
    ("Aviation", 3): ("Your operations lead tells you the incident report leaves out one maintenance check that was skipped.",
                      "Correct the report or not, and what you change in safety before the regulator rules."),
    ("Aviation", 4): ("A lender offers you a loan against your unpaid invoices at 18% interest.",
                      "Borrow, cut costs, or ask customers to pay early for a discount. Show the cash runway of your choice."),
    ("Fintech", 1): ("A customer who lost Rs 9 lakh goes on TV; your lawyers advise you to refund nobody until the cause is proven.",
                     "Refund everyone now, refund case by case, or wait. Show the cost, and what you change in the model."),
    ("Fintech", 2): ("Influencers tell your users to 'buy the dip' with borrowed money, using your app's name.",
                     "Warn your users even if trading falls, or stay quiet. How you protect users from the worst losses."),
    ("Fintech", 3): ("The hackers claim they still have access, and your security team cannot yet prove they are wrong.",
                     "Shut the app until it is safe, or stay open with extra checks. What it costs and what users are told."),
    ("Fintech", 4): ("A rival keeps selling the old product through an offshore company and takes your users.",
                     "Follow the rules and lose users, or find a compliant product that wins them back. Show revenue for both."),
}

# statement number -> (who it is for, the numbers, the catch, you win if)
BRIEFS = {
    1: ("A heritage watchmaker whose clients are mostly over 55.", "Its clients spend Rs 12 lakh a year on average; it wins only 300 new ones a year.", "Every new client must feel as exclusive as the old ones; one mass campaign could undo 40 years of the brand.", "1,000 new clients in a year with no fall in the average price paid."),
    2: ("A family that spends on travel, fashion, art and cars through 20 separate concierges.", "They spend about Rs 3 crore a year and lose roughly 40 hours a month to arranging it.", "They share their data with no one they do not trust completely.", "One assistant they use every week, and a fee they pay without asking for a discount."),
    3: ("Resale shops and buyers of second-hand luxury bags and watches.", "1 in 8 items offered for resale is fake, and an expert check takes 3 days and costs Rs 4,000.", "Counterfeits now pass the checks experts use, so a better eye is not enough.", "A check in under 60 seconds, at under Rs 200, that catches 99% of fakes."),
    4: ("Young professionals who earn well but cannot buy a Rs 50 lakh painting or car.", "A share can start at Rs 25,000, and a year of ownership must cost less than renting the item.", "Owners argue about who uses the car, when to sell and who pays for insurance.", "Shares that sell again within a week at a fair price, with no disputes left open."),
    5: ("Clients who bought a Rs 5 lakh piece and waited 3 months for a repair.", "Repairs take 90 days on average and 30% of clients do not buy again after one.", "The best craftsmen are few, and are in Europe.", "Repairs back in under 14 days and clients who buy again more often after a repair than before it."),
    6: ("A fashion house that wants clients to stay, eat and celebrate inside its world.", "A hotel costs Rs 200 crore to build; the brand has Rs 20 crore to spend.", "Hospitality is a different business, and one bad stay is seen by the whole fashion world.", "A first experience that sells out and earns money within 12 months."),
    7: ("Brands that use leather, gold and silk and are asked where they came from.", "Under 20% of their materials can be traced to the source today.", "Suppliers guard their sources, and new materials must still feel luxurious.", "80% of materials traced, with proof a client can see on the product."),
    8: ("Buyers aged 22 to 30 who prefer experiences, resale and their own feeds to the brand's store.", "They will be 40% of luxury buyers by 2030 but are 10% of this brand's sales.", "What attracts them may put off today's loyal clients.", "Doubling the brand's sales to buyers under 30 without losing its older clients."),
    9: ("Families whose wealth, travel and purchases are tracked by apps, staff and hackers.", "One leak can cost a client crores in fraud or kidnap risk.", "Clients want privacy and the convenience of apps at the same time.", "A service clients trust with their data, audited by an outside firm, that nobody leaves."),
    10: ("A luxury group with 50,000 old pieces in its clients' cupboards.", "Each piece can be repaired and resold 2 or 3 times; today 5% are.", "Resale must not make new pieces look cheaper.", "Resale and repair worth 15% of the group's revenue within 3 years."),
    11: ("A dairy and fresh-produce brand that sells through 30,000 shops.", "9% of its fresh stock is thrown away, worth Rs 60 crore a year.", "Shops do not share their sales data and have no space for new equipment.", "Waste at 3% within a year, with shops earning more than before."),
    12: ("A biscuit and soap company that sells in cities but hardly reaches villages.", "A rural kirana orders Rs 2,000 a week, and each delivery costs Rs 300.", "Roads, cash payments and tiny orders make every visit expensive.", "50,000 shops served at a profit on every order within 18 months."),
    13: ("A snacks brand selling 2 crore packs a month.", "Plastic packaging costs Rs 1.20 a pack; the alternatives cost Rs 3 or more.", "Food must stay fresh for 6 months in hot, humid shops.", "Plastic-free packs at under Rs 2.20 a pack with the same shelf life."),
    14: ("Shoppers who spend 4 seconds choosing a pack of noodles.", "Under 10% read the label, and most claims on the front are vague.", "Brands fear honest labels will hurt sales.", "A label that changes what at least 1 shopper in 5 buys, with sales held."),
    15: ("A sweets and snacks brand planning Diwali.", "Last year it overstocked metros by 40% and ran out in small towns, a Rs 3.2 crore loss.", "Every city and town celebrates differently, and data from small shops is thin.", "A forecast within 10% in every city type, tested on last year's festival."),
    16: ("A new healthy-food brand on quick-commerce apps.", "The top 3 brands take 80% of the first screen, and paying for placement costs 25% of sales.", "The apps own the customer data and change their rankings often.", "First-screen placement in 3 cities while spending under 10% of sales on it."),
    17: ("Students and workers who buy snacks at Rs 10 to Rs 20.", "Healthy snacks today cost Rs 50 or more.", "Better ingredients cost more, and cheap healthy snacks often taste worse.", "A healthy snack at Rs 20 that sells 1 lakh packs a month and earns a margin."),
    18: ("A spice and tea company with 4,000 farmers.", "Tracing a single ingredient today takes 3 weeks and a phone call to each supplier.", "Farmers have basic phones, and middlemen do not want to be seen.", "Every pack traceable to its farms in under 10 seconds."),
    19: ("City households that buy detergent, shampoo and oil in plastic bottles.", "A family throws away about 150 bottles a year.", "Refills must be no harder and no dearer than buying a new bottle.", "20,000 households refilling every month and 30% less plastic sold."),
    20: ("Some of India's 10 crore people with diabetes, and their families.", "Most see a doctor twice a year and get the same generic diet chart.", "Food is cultural, budgets are tight, and nobody wants to feel ill.", "Members whose blood sugar improves measurably within 6 months, at under Rs 500 a month."),
    21: ("Renters and apartment residents who cannot put panels on a roof they do not own.", "Half of city homes are rented or in tall blocks.", "Owners, residents' associations and the power company must all agree.", "500 flats on solar in a year, with tenants saving 20% on their bills."),
    22: ("Highway charging-station investors.", "A fast charger costs Rs 40 lakh and sees only 6 cars a day today.", "Highway traffic is seasonal and EV numbers are still small.", "A site that pays back in 3 years with today's traffic."),
    23: ("Home and shop battery owners in North India.", "Batteries lose half their life in 45°C heat.", "Cooling uses the power the battery is meant to save.", "Batteries that keep 80% of their capacity after 10 hot summers, at no more than 15% extra cost."),
    24: ("Small factories that export to Europe and must report their carbon.", "A carbon audit costs Rs 5 lakh; most factories earn Rs 2 crore a year.", "Factory owners have no data team and do not trust software.", "A report that buyers accept, for under Rs 25,000 a year."),
    25: ("A city power company that buys expensive power at 7 pm every summer evening.", "Peak power costs 4× normal, and a 10% cut would avoid blackouts.", "Nobody wants to be told when to use their AC.", "Peak demand down 10% with no blackouts and no forced switch-offs."),
    26: ("Rural homes still cooking on wood and dung.", "Smoke from cooking harms health in millions of homes; an LPG refill costs a week's income.", "Families go back to wood when gas runs out or gets dear.", "10,000 homes cooking clean every day after a year, not only on day one."),
    27: ("Owners of used EV batteries and old solar panels.", "1 lakh tonnes of batteries will retire each year by 2030; under 10% are recycled properly.", "Informal recyclers pay more and pollute.", "A recycling route that pays owners as much as the informal trade and recovers 90% of the metals."),
    28: ("Farmers' cooperatives that store fruit and vegetables.", "Up to 30% of produce rots for lack of cold storage; diesel cold rooms cost Rs 1,500 a day to run.", "Villages have power for only part of the day.", "Cold storage running on clean power at half the cost of diesel."),
    29: ("Households on a city power network.", "The power company pays Rs 12 for a unit at peak and sells it to homes at Rs 7.", "Saving must be easy and the payment worth noticing.", "50,000 homes paid every month, with savings the power company can measure."),
    30: ("Data-centre operators that promise clients clean power at every hour.", "Solar covers the day; nights and cloudy weeks still run on coal.", "Storage for every hour is very expensive.", "90% clean power around the clock at a price clients accept."),
    31: ("Passengers at a busy metro airport.", "Check-in to boarding takes 75 minutes at peak, and 1 in 20 miss a flight because of queues.", "Security rules cannot change and space cannot grow.", "Under 35 minutes at peak, with no extra security staff."),
    32: ("Passengers who use wheelchairs, are blind or deaf, or have hidden disabilities.", "1 in 4 report a bad experience, and 1 in 10 a damaged wheelchair.", "Many staff are untrained and every airport works differently.", "Complaints halved and every passenger able to book help in one step."),
    33: ("A low-cost airline that earns only while its planes fly.", "A turnaround takes 45 minutes; every 5 minutes saved is worth Rs 30 crore a year.", "The ground crew is already stretched and safety checks cannot be skipped.", "A 36-minute turnaround with the same staff and no new safety issues."),
    34: ("Passengers whose bags are delayed or lost.", "7 bags in 1,000 go astray, and most take 3 days to return.", "Bags pass through airlines, airports and ground handlers who do not share data.", "95% of bags back with their owner within 24 hours."),
    35: ("People in towns 300 km from the nearest airport.", "A 50-seat plane costs Rs 1.5 lakh an hour to fly, and flights must sell for under Rs 3,000.", "Small airports have short runways and few passengers on weekdays.", "A route that fills 70% of seats and covers its costs within a year."),
    36: ("Clinics in hill and island areas waiting days for medicines.", "A road trip takes 6 hours; a drone takes 30 minutes.", "Weather, the rules on flying and keeping medicines cold.", "1,000 deliveries a month, on time, with every medicine safe on arrival."),
    37: ("An airline whose fuel is 40% of its costs.", "A 10% saving is worth Rs 500 crore a year.", "Pilots, dispatchers and air traffic control all decide part of every flight.", "Fuel burn down 10% on the routes tested, measured flight by flight."),
    38: ("Airlines that must start blending sustainable fuel.", "Sustainable aviation fuel costs 3× jet fuel; India burns 50 crore tonnes of crop waste a year.", "Collecting farm waste is seasonal and spread over thousands of villages.", "A pilot plant that makes fuel at under 2× the price of jet fuel."),
    39: ("Travellers who book a cab, a flight, a train and a hotel in five apps.", "1 in 3 journeys has a missed connection or a wasted hour.", "Every operator wants to own the customer.", "One booking that re-plans itself when anything is late, used by 1 lakh travellers."),
    40: ("Maintenance teams of an airline with 80 planes.", "A grounded plane costs Rs 50 lakh a day, and 30% of groundings come from part failures.", "Sensor data is huge and the regulator demands proof for every change.", "Groundings from part failures cut by half, with no missed safety check."),
    41: ("First-time investors under 25 who trade options on their phones.", "9 in 10 small options traders lose money; their average loss is Rs 1.1 lakh a year.", "Options trading earns brokers money, and users want excitement.", "Users who lose less, measured over 6 months, and a business that still earns."),
    42: ("Kirana owners who need Rs 50,000 for stock before a festival.", "Moneylenders charge 4% a month; banks refuse loans to shops without a credit history.", "No papers, irregular income and cash sales.", "Loans within a day at under 2% a month, with under 3% unpaid."),
    43: ("UPI users who are tricked into sending money.", "Fraud losses are rising each year, and most of the money is never recovered.", "Payments settle in seconds and false alarms annoy honest users.", "Fraud stopped before the money leaves in 8 cases out of 10, with under 1 honest payment in 1,000 stopped."),
    44: ("Savers with 5 to 15 mutual funds and stocks they no longer remember buying.", "Most cannot say what they would lose in a bad year.", "Risk is complex, and simple screens hide what matters.", "A screen that 8 in 10 users understand in a test, and that leads them to act."),
    45: ("Delivery riders and drivers with no employer pension.", "A rider earns about Rs 20,000 a month, and earnings change weekly.", "Money is tight now and retirement feels far away.", "1 lakh gig workers saving every month for a year."),
    46: ("Families claiming health or motor insurance.", "A claim takes 15 to 30 days and 1 in 5 is disputed.", "Insurers fear fraud, and hospitals and garages have their own systems.", "80% of claims settled within 24 hours, with fraud no higher than today."),
    47: ("Small exporters waiting 90 days to be paid by foreign buyers.", "Unpaid invoices lock up 30% of their working capital; banks ask for property as security.", "Buyers are abroad, in other currencies and under other laws.", "Invoices paid in 48 hours at under 1.5% a month."),
    48: ("Young earners in their first job.", "Most know what a SIP is, but under 20% have one; credit-card debt is rising.", "Knowing is not doing, and lessons are boring.", "Users who start saving and stay out of expensive debt, measured after 6 months."),
    49: ("Small businesses and young people with no credit card or loan history.", "Bureau scores cover only a part of adults.", "Data from bank accounts and GST must be shared with consent, and kept safe.", "Loans to 50,000 people without a bureau score, with repayments as good as with one."),
    50: ("Lenders and insurers that use AI to say yes or no.", "Customers cannot ask why they were refused, and regulators are starting to ask.", "Explaining a model can reveal secrets or make it worse.", "A system that explains every decision and passes an outside audit, with no loss in accuracy."),
}

def read(name):
    text = (LIB / name).read_text(encoding="utf-8")
    rows = list(csv.reader(io.StringIO(text)))
    return rows[0], rows[1:]

def write(name, header, rows):
    out = io.StringIO()
    csv.writer(out, lineterminator="\r\n").writerows([header, *rows])
    (LIB / name).write_text(out.getvalue(), encoding="utf-8")

header, rows = read("crisis-cards.csv")
assert header == ["sector", "category", "number", "title", "body"]
for r in rows:
    twist, decide = TWISTS[(r[0], int(r[2]))]
    base = r[4].split("\n\nThe twist:")[0]
    r[4] = f"{base}\n\nThe twist: {twist}\n\nYour plan must decide: {decide}"
    assert len(r[4]) <= 4000
write("crisis-cards.csv", header, rows)

header, rows = read("statements.csv")
assert header == ["sector", "number", "title", "body", "cap"]
for r in rows:
    who, numbers, catch, win = BRIEFS[int(r[1])]
    r[3] = (f"{r[0]} · Round 3. {r[2]}.\n\nWho it is for: {who}\nThe numbers: {numbers}\nThe catch: {catch}\n"
            f"You win if: {win}\n\nDesign the solution, how it is delivered and how it is measured.")
    assert len(r[3]) <= 4000
write("statements.csv", header, rows)
print("crisis cards:", len(TWISTS), "statements:", len(BRIEFS))
