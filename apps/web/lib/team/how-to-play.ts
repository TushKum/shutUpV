// "How to play" for each track: the whole night in a few plain steps, so a team knows from the start what it will do
// and how it wins. PRIMUS (three rounds with crises, hiring and the draft) or the classic night.

import type { Track } from "@msim/engine";

export interface PlayStep {
  icon: string;
  title: string;
  text: string;
}

export interface HowToPlay {
  role: string;
  steps: PlayStep[];
  win: string;
}

const PRIMUS: Record<Track, HowToPlay> = {
  PRODUCT: {
    role: "You are a startup. Your company is listed on the market and its share price is your score.",
    steps: [
      { icon: "🚀", title: "Round 1 · Build", text: "Write your PRD: your startup's plan. Its score sets your first share price (the IPO)." },
      { icon: "🚨", title: "Round 2 · Four crises", text: "Each crisis: hire a consulting firm, write a response plan, then rate the firm. Good plans lift your price." },
      { icon: "🧩", title: "Round 3 · The final problem", text: "Pick a problem statement in the draft, then solve it with a firm. Companies on the same statement compete." },
    ],
    win: "Finish with the most value: your shares × the closing price + your cash.",
  },
  CONSULTING: {
    role: "You are a consulting firm. Companies hire you for advice and pay you fees.",
    steps: [
      { icon: "📝", title: "Round 1 · Prove yourself", text: "Write a crisis memo on the same case as every firm, and call BUY or SELL on the companies you follow." },
      { icon: "🤝", title: "Round 2 · Win clients", text: "Fill in your profile, answer offers, then write an advice memo for each client. No memo, no fee." },
      { icon: "⭐", title: "Round 3 · The last job", text: "Get hired again and help your client's solution. Every client rates you 1 to 5 stars." },
    ],
    win: "Finish with the highest firm value: fees, bonuses and fee shares.",
  },
  FINANCE: {
    role: "You are an investment fund with real (game) money to grow.",
    steps: [
      { icon: "🔎", title: "Round 1 · Pick winners", text: "Read the PRDs, ask questions, bid in the IPO and make your first trades." },
      { icon: "📉", title: "Round 2 · Trade the crises", text: "Each crisis knocks prices down; plan scores move them again. Buy, sell, short or cover in each trading round." },
      { icon: "💰", title: "Round 3 · Fresh capital", text: "You get half your starting money again. Watch the draft: companies on a crowded statement share the rise." },
    ],
    win: "Finish with the highest return on all the money you were given.",
  },
};

const CLASSIC: Record<Track, HowToPlay> = {
  PRODUCT: {
    role: "You are a startup. Your company's share price is your score.",
    steps: [
      { icon: "🚀", title: "Build", text: "Write your PRD; its score sets the IPO price." },
      { icon: "🛟", title: "Crisis and rescue", text: "Agree the fee and the rescue deal, and write the rescue plan with your consultant." },
      { icon: "📰", title: "Breaking news", text: "Answer the flash news in 100 words." },
    ],
    win: "Finish with the most value: your shares × the closing price + your cash.",
  },
  CONSULTING: {
    role: "You are the advisers to your squad's company.",
    steps: [
      { icon: "📝", title: "Help and call", text: "Help the PRD, then call BUY or SELL on the two companies you follow." },
      { icon: "🛟", title: "Crisis and rescue", text: "Agree your fee, set the deal price and co-write the rescue plan." },
      { icon: "📞", title: "Last calls", text: "Make your last BUY or SELL calls." },
    ],
    win: "Finish with the most earned: fees, deal bonus and correct calls.",
  },
  FINANCE: {
    role: "You are an investment fund with real (game) money to grow.",
    steps: [
      { icon: "🔎", title: "Pick winners", text: "Read the pitches, bid in the IPO and trade." },
      { icon: "🛟", title: "The rescue", text: "Invest in your squad's rescue deal and keep trading." },
      { icon: "📰", title: "Trade the news", text: "Trade the verdicts and the flash news." },
    ],
    win: "Finish with the highest return.",
  },
};

export const howToPlay = (track: Track, format: "CLASSIC" | "PRIMUS") => (format === "PRIMUS" ? PRIMUS : CLASSIC)[track];
