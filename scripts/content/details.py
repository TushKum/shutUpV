# Guidance written around the game's cards (the card texts themselves are read from seed/sectors/*.csv).
# Keyed by (sector, crisis number) and by Round 3 statement number. Nothing here adds facts to the cards: the numbers
# quoted are the cards' own; everything else is advice on what a strong answer covers.

CRISES = {
    ("Luxury", 1): {
        "on_card": ["40,000 high-net-worth clients' profiles and purchase histories leaked",
                    "The breach is at a partner platform, but the press names your brand",
                    "Members are already cancelling"],
        "impact": "Discretion is part of what luxury clients pay for, so a leak hits trust, retention and the brand's name at "
                  "once, and it exposes how much the company depends on an outside platform.",
        "plan": ["Protect clients first: tell the people affected, secure their accounts, reach out personally to the most valuable",
                 "Rebuild confidentiality: what data the company holds, who can see it, what changes now",
                 "Reduce dependence on the breached platform, and cost the switch",
                 "Estimate the revenue at risk (memberships cancelled and spending lost) against the cost of the response"],
        "advice": "Separate what the company controls (its own data, its words, its service) from what it does not (the "
                  "partner's systems); set the order of the first 72 hours; price retention offers against what a top client is worth.",
        "watch": "How many members cancel and how many stay, how fast and how honestly the company responds, and its dependence on outside platforms.",
    },
    ("Luxury", 2): {
        "on_card": ["A startup sells ultra-personalised experiences without ownership",
                    "20% of your clients move spending to it within a quarter",
                    "Engagement with your products falls"],
        "impact": "Revenue from a fifth of clients is at risk and the shift may spread; the company has to decide whether it "
                  "sells products, access or experiences.",
        "plan": ["Decide between partnering with, acquiring, copying or differentiating from the rival",
                 "Add experiences only where they fit the brand",
                 "Show the value of each option: revenue kept or won against what it costs",
                 "Say how you will know within weeks whether the clients are coming back"],
        "advice": "Find out which clients left and why; test one experience offer quickly before a big bet; protect what the "
                  "rival cannot copy, such as craft, heritage and personal service.",
        "watch": "Whether the lost clients return, what the new offer costs, and whether the brand stays premium.",
    },
    ("Luxury", 3): {
        "on_card": ["Hyper-realistic counterfeits that even experts cannot tell apart",
                    "Resale prices of authentic pieces fall 30%",
                    "Returns from buyers who fear fakes rise 4×"],
        "impact": "Resale value supports the price new buyers will pay; when nobody can prove what is genuine, both the resale "
                  "market and new sales suffer.",
        "plan": ["Prove authenticity: digital IDs, verified resale, guarantees",
                 "Handle the returns now and reassure existing clients",
                 "Protect resale value of genuine pieces",
                 "Cost the programme against the sales at risk"],
        "advice": "Choose a verification method clients will trust and that can be rolled out quickly; decide who pays for it; "
                  "set a fair returns policy for the buyers who are worried today.",
        "watch": "Resale prices and return rates after the response, and the cost and speed of the authentication rollout.",
    },
    ("Luxury", 4): {
        "on_card": ["Luxury retail falls 18%", "High-end hospitality bookings fall 25%", "Luxury real estate deals fall 30%",
                    "Your next funding round is postponed"],
        "impact": "Revenue falls just as outside money stops, so the cash runway becomes the main constraint.",
        "plan": ["Protect cash without discounting the brand",
                 "Focus on the most loyal clients and delay expansion",
                 "Find revenue that holds up in a downturn (services, maintenance, top clients)",
                 "Show the runway in months under the card's falls"],
        "advice": "Model the runway with the card's numbers; rank cost cuts by how much they damage the brand; name the revenue "
                  "that survives a downturn.",
        "watch": "Months of runway, whether the company discounts (which damages the brand) or holds its prices, and how many top clients it keeps.",
    },
    ("FMCG", 1): {
        "on_card": ["A 46°C heatwave in North India", "The cold chain fails in 3 cities", "18% of this week's stock spoils",
                    "2,400 customers complain; refunds cost Rs 41 lakh"],
        "impact": "A loss this week (stock and refunds) and a hit to reputation, with more hot weeks likely to come.",
        "plan": ["Protect the stock that is left first, then the customers",
                 "Decide who gets refunds and how fast",
                 "Change storage and routes so the next heatwave hurts less",
                 "Price the fix against the loss on the card"],
        "advice": "Separate the immediate fix (backup storage, new routes, night deliveries) from the lasting one (a cold chain "
                  "that survives heat); compare its cost with the Rs 41 lakh already lost.",
        "watch": "How fast the losses stop, whether complaints fall, and the cost of the fix against the margin.",
    },
    ("FMCG", 2): {
        "on_card": ["A quick-commerce giant gives away a free version of your core product or service to its partners",
                    "22% of your customers say they will switch within a month"],
        "impact": "Competition at a price of zero: losing a fifth of customers in a month would hit revenue and the growth story.",
        "plan": ["Find what the free version cannot do",
                 "Defend the customers who value that most",
                 "Choose between partnering, narrowing to a niche or competing on price, with the cost of each",
                 "Track how many customers actually leave against the 22% threat"],
        "advice": "Identify the customers most likely to switch and why others would stay; set a ceiling on what retention may cost; "
                  "consider working with the giant rather than against it.",
        "watch": "Actual churn against the 22% threat, and the margin after any price response.",
    },
    ("FMCG", 3): {
        "on_card": ["A key supplier faked its 'plastic-free' and 'organic' data", "Your packs carry those claims",
                    "#Greenwashing trends with your name in it"],
        "impact": "Shoppers and retailers now doubt every claim the company makes; retailers or regulators may act; the supplier "
                  "has become a liability.",
        "plan": ["Own it quickly and say what was wrong",
                 "Pull or relabel the packs that carry false claims",
                 "Verify suppliers independently and show the proof",
                 "Estimate the cost and the sales at risk"],
        "advice": "Get the first statement and its timing right; bring in independent audits; decide what to do with the supplier; "
                  "rebuild each claim only with proof.",
        "watch": "The speed and honesty of the response, how retailers react, and the cost of relabelling and audits.",
    },
    ("FMCG", 4): {
        "on_card": ["Palm oil, packaging and fuel costs rise 30% in a quarter", "Gross margin falls from 34% to 21%",
                    "Your next funding round is in doubt"],
        "impact": "Over a third of the margin is gone, and with funding in doubt the company must live on its own cash flow.",
        "plan": ["Choose between price rises, smaller packs, cheaper inputs and cost cuts",
                 "Say which products to protect and which to cut",
                 "Show the margin you expect after the plan",
                 "Show the cash runway under the chosen plan"],
        "advice": "Test what shoppers will accept (a higher price or a smaller pack); renegotiate or switch inputs; rank products by "
                  "margin; show the path back towards 34%.",
        "watch": "The margin after the plan, how many sales the price rise costs, and the runway.",
    },
    ("Energy", 1): {
        "on_card": ["A 9-hour blackout across 4 states", "Your systems or stations go offline",
                    "30% of customers miss service", "Penalty clauses cost Rs 55 lakh"],
        "impact": "Penalties now, and the promise of reliable power is broken in front of customers.",
        "plan": ["Restore service in order of customer impact",
                 "Communicate clearly during and after the outage",
                 "Design backup or islanding so the next blackout hurts less",
                 "Cost the backup against the penalties and lost customers"],
        "advice": "Set the order of restoration; handle the penalty clauses (credits, renegotiation); weigh the cost of backup against "
                  "the expected cost of future outages.",
        "watch": "Penalties paid, customers lost, and what the backup investment costs.",
    },
    ("Energy", 2): {
        "on_card": ["Imported solar panels and batteries drop 25% in price", "Your hardware now costs more than rivals'",
                    "Two big orders are cancelled"],
        "impact": "The hardware margin and the order book are hit together, and competing on price alone may not work.",
        "plan": ["Compete where imports are weak: service, warranty, financing, installation quality",
                 "Or change suppliers, and say what that does to quality and margin",
                 "Try to win back the cancelled orders",
                 "Show the new margin"],
        "advice": "Decide between switching to imported components and moving up to services; say what would win back the two "
                  "orders; work out the new unit economics.",
        "watch": "The margin after the response, and whether the order book recovers.",
    },
    ("Energy", 3): {
        "on_card": ["A battery-fire video at a customer site gets 4 million views", "The fire was not proven to be yours",
                    "Bookings fall 40%", "A regulator asks for safety data"],
        "impact": "Fear spreads faster than facts: sales drop and the regulator starts asking questions.",
        "plan": ["Be transparent, and cooperate with the regulator",
                 "Publish safety evidence",
                 "Offer free inspections to customers",
                 "Estimate the cost of rebuilding bookings"],
        "advice": "Say what to state (and not to state) before the facts are known; commission an independent safety review; choose "
                  "reassurance that customers value; cost it all.",
        "watch": "Whether bookings recover, the regulator's response, and the cost of inspections.",
    },
    ("Energy", 4): {
        "on_card": ["The subsidy your customers rely on falls from Rs 30,000 to Rs 10,000",
                    "Your payback pitch of 4 years becomes 6.5 years"],
        "impact": "The main selling point, the payback period, gets much worse overnight; demand falls; the business case leaned on policy.",
        "plan": ["Rebuild the offer without the subsidy",
                 "Options: financing, smaller systems, a new customer segment",
                 "Show the payback customers will now see",
                 "Show the runway"],
        "advice": "Work out the customer's payback under each option (financing, a smaller system, business customers); name the "
                  "segment that still buys; show the runway.",
        "watch": "How much of the business depends on subsidies, the new payback offered, and orders after the cut.",
    },
}

# Round 3: what a strong solution to each statement shows (by the statement's number in statements.csv).
STATEMENTS = {
    1: "Who the new clients are, how access stays scarce (invitations, limits, tiers), and how you measure that existing clients do not leave or spend less.",
    2: "Which needs it brings together (travel, shopping, homes, events), how it learns preferences while keeping data private, and what clients pay for it.",
    3: "How an item is checked at the point of sale or resale, who pays, what happens to items already in circulation, and the error rate you can promise.",
    4: "Which assets, how shares are bought, held and sold, who looks after the asset, and how owners get value from it, within the rules.",
    5: "Repair, maintenance and restoration as one service: turnaround times, quality control, and how it keeps clients loyal and spending.",
    6: "The experience (hotel, club, café, events), how it fits the brand without diluting it, and the economics per guest or member.",
    7: "Which material, how every step is traced and proven, the premium clients will pay, and how the claims are checked independently.",
    8: "Who these buyers are and what they value, the product and channel that reach them, and measures such as first purchases and repeat rate.",
    9: "What data is protected, how clients control it, how breaches are prevented and handled, and why clients would pay for it.",
    10: "How items come back, are authenticated, restored and resold; the margin per item; and how it protects the brand's prices.",
    11: "Where in the chain the waste happens, the tool or process that removes it (forecasting, routing, redistribution), and the saving per tonne or per shop.",
    12: "The ordering and delivery model, the cost per drop against the order size, how shops pay, and how you reach the first 1,000 shops.",
    13: "The material, its cost per pack at scale, shelf life and supply, and the proof that it is plastic-free.",
    14: "The label or tool, how claims are checked, and evidence that shoppers notice it and change what they buy.",
    15: "The data used (sales, retailer orders, weather, local events), how accuracy is measured and improved, and what better forecasts save.",
    16: "How a smaller brand gets ranked and stocked, what it offers the app, and the cost of each order won.",
    17: "The product, its cost and margin at Rs 20 or less per pack, and how it reaches mass-market shops.",
    18: "How data is captured at each step, who enters it, how it is verified, and what brands and shoppers see.",
    19: "How containers come back and are refilled, the cost per refill against a new pack, and the return rate needed to break even.",
    20: "Who the users are, how advice or products are personalised, how outcomes are tracked safely, and who pays.",
    21: "How residents who do not own the roof take part, how savings are shared and billed, and the payback for each resident.",
    22: "Where the chargers go and why, the cost per charger, the use needed for a 3-year payback, and every revenue stream.",
    23: "The chemistry or cooling design, the testing that proves it, the warranty you can offer, and the cost per kWh over the battery's life.",
    24: "What it measures and how, the monthly price a small factory can pay, and how tracking turns into savings.",
    25: "How demand is moved or reduced at peak (tariffs, storage, smart devices), who is paid for it, and how much peak demand it removes.",
    26: "The stove or fuel, its price and running cost against today's fuel, how it reaches villages, and how families keep using it.",
    27: "How batteries are collected, tested and recycled or reused, the value recovered per battery, and how they are handled safely.",
    28: "The power system (solar, storage), the cold storage it runs, the cost per farmer, and the produce it saves from spoiling.",
    29: "How savings are measured, how households are paid and by whom, and why the grid or the utility gains from it.",
    30: "How the power stays clean around the clock (storage, contracts, the mix), the cost per unit against grid power, and the proof behind the carbon claims.",
}

# ───────────── The two extra sectors (not in the game's upload files) ─────────────

CRISES.update({
    ("Aviation", 1): {
        "on_card": ["The live air-traffic feed the product depends on goes down for 9 hours",
                    "The busiest travel day of the season: 31,000 passengers' flights disrupted",
                    "Customers see stale or missing data"],
        "impact": "A data business is only as good as its feed: the outage was not the company's fault, but its customers judge "
                  "it on the day they needed it most, and the press is ready to blame it.",
        "plan": ["Tell customers at once what is affected and what still works; mark stale data clearly rather than show it as live",
                 "Switch to backup sources where possible (other feeds, airport and airline data, last known state)",
                 "Make the twist's decision: prove the cause publicly or help first and argue later",
                 "Add redundancy for the next outage and cost it against the business lost in this one"],
        "advice": "Separate the facts (whose system failed, what the product showed) from the story in the news; list the backup "
                  "data the company can buy or build; price an outage day against the cost of redundancy.",
        "watch": "Customers who leave after the outage, how quickly the company communicated, and whether it now has a second data source.",
    },
    ("Aviation", 2): {
        "on_card": ["The national air-navigation provider launches a free analytics dashboard on the same data",
                    "Every airline and airport can use it",
                    "30% of users plan to switch within a quarter"],
        "impact": "The company's raw material is now given away free by the most trusted source in the market: whatever it sells "
                  "must be worth more than the free version.",
        "plan": ["Find what the free dashboard cannot do (predictions, integration, a specific user, speed, support)",
                 "Defend the users who value that difference; let the rest go if they only wanted the basics",
                 "Make the twist's decision: run the provider's dashboard under its brand, refuse, or serve who it ignores",
                 "Compare the revenue of each option over a year"],
        "advice": "Map which customers need more than a dashboard; price a white-label contract against the loss of the company's "
                  "own users and brand; consider partnering rather than competing with the provider.",
        "watch": "User retention after the launch, revenue per remaining customer, and dependence on the provider's goodwill.",
    },
    ("Aviation", 3): {
        "on_card": ["A drone and a training aircraft came too close near a busy airport",
                    "An alert from the product reached users late that day",
                    "The regulator investigates; bookings fall 35%"],
        "impact": "In aviation a safety question outweighs everything else: even with no one hurt, customers stop relying on an "
                  "alert they cannot trust, and the regulator can restrict the service.",
        "plan": ["Cooperate fully with the investigation and share the data",
                 "Make the twist's decision: disclose the unreported 4-minute delay or not, and why",
                 "Fix the cause and add monitoring so a delay is caught and reported at once",
                 "Show how and when bookings recover, and what the response costs"],
        "advice": "Set out what disclosure costs now against what concealment costs if it surfaces later; propose the monitoring "
                  "and reporting changes; plan how the company talks to customers and the regulator.",
        "watch": "The regulator's findings, whether the company disclosed the delay, and how many customers keep relying on its alerts.",
    },
    ("Aviation", 4): {
        "on_card": ["Jet fuel prices rise 35% in a month", "Airlines cut spending on new projects by a quarter",
                    "Your invoices are paid 60 days later"],
        "impact": "Less new business and slower payments at once: cash gets tight even though the company did nothing wrong.",
        "plan": ["Protect cash: renegotiate payment terms",
                 "Show airlines how you save them fuel or money",
                 "Cut costs",
                 "Show the runway"],
        "advice": "Model cash with payments 60 days later; rank customers by the savings the company brings them; propose terms that "
                  "share those savings.",
        "watch": "Months of runway, overdue invoices, and whether the product becomes a way for airlines to save money.",
    },
    ("Fintech", 1): {
        "on_card": ["A bug in your model makes 6,000 wrong trades or loan decisions", "It happens in one morning",
                    "Customers lose Rs 2.1 crore before you stop it"],
        "impact": "Customers lose real money because of the company's own system: compensation, the regulator's attention and trust are all at stake.",
        "plan": ["Stop it at once",
                 "Make customers whole",
                 "Find the root cause",
                 "Add controls (limits, human review, testing) and cost the compensation"],
        "advice": "Set the order of the response (stop, compensate, explain); size compensation against the Rs 2.1 crore; design the "
                  "controls that would have caught the bug.",
        "watch": "The size of the compensation, any action by the regulator, and whether users stay.",
    },
    ("Fintech", 2): {
        "on_card": ["The market falls 14% in five days", "Users' portfolios (or borrowers' sales) drop sharply",
                    "25% of users stop using the app"],
        "impact": "Revenue tied to activity or loans falls, defaults may rise, and a quarter of users have gone quiet.",
        "plan": ["Communicate early",
                 "Help users avoid panic decisions",
                 "Protect the business from defaults or outflows",
                 "Show the runway"],
        "advice": "Group users by risk; design the messages and tools that prevent panic selling; stress-test defaults on the loan book.",
        "watch": "How many users come back, default rates, and money flowing out.",
    },
    ("Fintech", 3): {
        "on_card": ["Hackers leak the phone numbers and PAN details of 3 lakh users", "Fraud calls start the same day",
                    "The news covers it"],
        "impact": "Users face fraud now, the regulator must be told, and trust, the company's main asset, is damaged.",
        "plan": ["Notify users and the regulator",
                 "Contain the breach",
                 "Protect users from fraud",
                 "Fix security; estimate the cost and the users at risk"],
        "advice": "Set the order of notification and containment; protect users from the fraud calls; plan the security fixes and an "
                  "independent audit.",
        "watch": "Users lost, any fine or order from the regulator, and the cost of the response.",
    },
    ("Fintech", 4): {
        "on_card": ["The central bank tightens the rules on your product",
                    "Lending caps, new KYC checks or limits on derivatives for small investors",
                    "Revenue from your main product falls 40%"],
        "impact": "The business model changes overnight: the main product earns 40% less and compliance costs rise.",
        "plan": ["Comply first",
                 "Rebuild revenue from what the rules still allow",
                 "Show the new business model in numbers"],
        "advice": "Map exactly what the new rules allow; size new sources of revenue; budget for compliance.",
        "watch": "Revenue after the change, compliance costs, and how fast the new model grows.",
    },
})

STATEMENTS.update({
    31: "The data it combines (air-traffic, weather, airport, schedule), how predictions are tested against what really happened, how the airline acts on a warning, and what a minute of delay avoided is worth.",
    32: "How it turns regional forecasts and live data into runway-level warnings, how accuracy and false alarms are measured, and what an airport pays against the cost of a diversion.",
    33: "Which flights and phases (holding, descent, routing) it improves, how it works with air traffic control rather than around it, how the saving is verified per flight, and how it is paid from the savings.",
    34: "How flights are planned, approved and tracked, how drones are kept clear of aircraft and no-fly zones, the approvals needed, and who pays: operators, cities or both.",
    35: "Where demand is (trips, times, prices), how routes avoid airport traffic and noise, the vertiport sites and their cost, and the steps to a regulator-approved pilot.",
    36: "How each shipment is located (data, scans, sensors), how missed connections are spotted early and fixed, who shares the data, and the value of cargo saved.",
    37: "How unused slots are spotted early from live traffic data, how they are offered again within the slot rules, and how the airport and airlines share the value.",
    38: "How each flight's carbon and noise are worked out from real tracks and aircraft data, how an auditor checks them, and who uses and pays for the figures.",
    39: "Which live data it uses (road traffic, queues, flight status), how the leave-by time is tested against real journeys, and how it earns money without selling personal data.",
    40: "The first data product and its buyer, how the data is anonymised and licensed, why it is worth paying for, and how the company finds its next customers.",
    41: "Who the users are, how the product steers them away from losses (education, limits, safer alternatives), how that is measured, and how it earns money without encouraging risky trading.",
    42: "The data used instead of a credit history, how fairness is checked, the defaults you expect, and the cost per loan.",
    43: "The signals used, how fast a decision is made, false alarms against fraud caught, and who pays: banks, apps or users.",
    44: "What the screen shows, how it is tested with real users, and evidence that it changes their decisions.",
    45: "How saving fits an irregular income, the product and its costs, how users are reached, and the savings built per user.",
    46: "Which claims, how they are checked fast without letting fraud through, the cost per claim, and who pays.",
    47: "How invoices are verified, the cost of money and the risk of default, the time to cash, and the price to exporters.",
    48: "The behaviour it targets, how the product changes it (nudges, practice, incentives), and how the change is measured.",
    49: "The data used, how consent is taken and managed, accuracy against real repayments, and who pays for the score.",
    50: "Which decisions it covers, how each decision is explained and logged, how bias is tested, and what an audit looks like.",
})
