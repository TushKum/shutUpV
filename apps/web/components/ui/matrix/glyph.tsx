// Green line icons (inline SVG) that stand in for the emoji the screens used. The app's data still names its icons
// by emoji (the section list, the round list), so an icon is looked up by its emoji; one without a drawing here
// is shown as the emoji itself. With `spoken`, the emoji stays in the page for screen readers and for the names of
// links and buttons, which therefore do not change.

const PATHS: Record<string, string> = {
  "🏠": "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
  "🧩": "M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 0 0 4v4H4z",
  "🛟": "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6",
  "💬": "M4 5h16v11H9l-5 4z",
  "✉": "M3 6h18v12H3zM3 6l9 7 9-7",
  "📞": "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A15 15 0 0 1 4 5a1 1 0 0 1 1-1z",
  "💰": "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5v11",
  "📈": "M4 4v16h16M7 15l4-4 3 3 5-6M15 8h4v4",
  "🏪": "M4 10l1.5-5h13L20 10M4 10v9h16v-9M4 10h16M9 19v-5h6v5",
  "❓": "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 16.5v.5",
  "📒": "M6 3h12v18H6zM9 3v18M12 8h3M12 12h3",
  "📣": "M4 10v4h3l8 4V6l-8 4H4zM18 9a4 4 0 0 1 0 6M8 14l1 5h2.5",
  "⚖": "M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z",
  "🔒": "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 14.5v2.5",
  "🎯": "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10zM12 11.5a.5.5 0 1 0 0 1a.5.5 0 0 0 0-1z",
  "⏱": "M12 7a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM12 10v4l2.5 1.5M10 3h4M12 3v4",
  "⏳": "M7 3h10M7 21h10M8 3v3l4 6-4 6v3M16 3v3l-4 6 4 6v3",
  "⏭": "M4 5l8 7-8 7zM12 5l8 7-8 7z",
  "🚀": "M12 3c3 2 5 5.5 5 9.5L15 16H9l-2-3.5C7 8.500 9 5 12 3zM12 9.5a1.500 1.500 0 1 0 0 3a1.500 1.500 0 0 0 0-3zM9 16l-2 4 3-1M15 16l2 4-3-1M12 17v4",
  "🚨": "M12 3l10 18H2zM12 10v5M12 17.5v.5",
  "📰": "M4 5h13v14H5a1 1 0 0 1-1-1zM17 9h3v9a1 1 0 0 1-1 1h-2M7 9h7M7 12.5h7M7 16h4",
  "🏆": "M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3.500 3.500 0 0 0 3.700 3.500M16 6h3.500a3.500 3.500 0 0 1-3.700 3.500M12 13v4M8.500 20h7M10 17h4",
  "👋": "M4 5h16v14H4zM7.5 9.5l3 2.5-3 2.5M12.5 15h4",
  "🏢": "M5 21V4h9v17M14 9h5v12M3 21h18M8 8h3M8 12h3M8 16h3M16.5 13v.5M16.5 17v.5",
  "🧠": "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.500 10.900c.6.5 1 1.300 1 2.100h5c0-.8.4-1.600 1-2.100A6 6 0 0 0 12 3z",
  "💼": "M3 8h18v11H3zM9 8V5h6v3M3 13h18",
  "💵": "M3 7h18v10H3zM12 9.5a2.500 2.500 0 1 0 0 5a2.500 2.500 0 0 0 0-5zM6 10v4M18 10v4",
  "📝": "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3",
  "✅": "M4 4h16v16H4zM8 12l3 3 5-6",
  "ℹ": "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 11v6M12 7.5v.5",
  "👍": "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM8 12.5l3 3 5-6",
  "☕": "M5 9h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM17 10h1.500a2.500 2.500 0 0 1 0 5H17M8 3v3M12 3v3",
  "📊": "M4 20h16M7 20v-7M12 20V6M17 20v-10",
  "👥": "M9 5a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM3 20a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.500M17 14.5a6 6 0 0 1 4 5.500",
  "🧾": "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  "🔔": "M6 17v-6a6 6 0 0 1 12 0v6l2 2H4zM10 21h4",
  "🔕": "M6 17v-6a6 6 0 0 1 12 0v6l2 2H4zM10 21h4M4 4l16 16",
  // Badges (apps/web/lib/team/badges.ts).
  "🏅": "M8 3l4 7 4-7M12 10a5 5 0 1 0 0 10a5 5 0 0 0 0-10zM12 13l1 2h2l-1.5 1.5.5 2-2-1-2 1 .5-2L9 15h2z",
  "⭐": "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  "🙋": "M12 4a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM6 21a6 6 0 0 1 12 0M18 3v6",
  "💎": "M6 4h12l3 5-9 11L3 9zM3 9h18M9 4l3 16M15 4l-3 16",
  "🔮": "M12 3a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM7 21h10M9 17l-1 4M15 17l1 4M9.5 8.5a3 3 0 0 1 3-2",
  "🤝": "M3 11l4-4 5 3 5-3 4 4M7 7l-4 8 5 4 4-3 4 3 5-4-4-8M9 13l3 3M12 11l3 3",
  "🛎": "M4 18h16M5 18a7 7 0 0 1 14 0M12 9V7M10 7h4",
  "🌱": "M12 21V11M12 11c0-4-3-6-7-6 0 4 3 6 7 6zM12 14c0-3 2.5-5 6-5 0 3-2.5 5-6 5z",
  "🧺": "M3 10h18l-2 10H5zM7 10l3-6M17 10l-3-6M9 14v3M12 14v3M15 14v3",
  "⚡": "M13 3L5 13h6l-1 8 8-10h-6z",
  "📉": "M4 4v16h16M7 9l4 4 3-3 5 6M15 16h4v-4",
  "🔥": "M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.500 2-4.500 0 2 1 3 2 3 0-3-1-5 1-8.500z",
  // Sectors and the How to play card.
  "🛒": "M3 4h2.5l2.200 10.500h10.300L20 7H6.300M9 18.500a1.200 1.200 0 1 0 0 .01M17 18.500a1.200 1.200 0 1 0 0 .01",
  "✈": "M21 15.500v-2L13 8.500V4a1.500 1.500 0 0 0-3 0v4.500l-8 5v2l8-2.500V18l-2 1.500V21l3.500-1 3.500 1v-1.500L13 18v-4.500z",
  "🏦": "M3 9l9-5 9 5M4 9h16M5 9v9M9 9v9M15 9v9M19 9v9M3 20h18",
  "🎮": "M6 8h12a4 4 0 0 1 3.800 5.300l-1 3a2.500 2.500 0 0 1-4.300.8L14.500 15h-5l-2 2.100a2.500 2.500 0 0 1-4.300-.8l-1-3A4 4 0 0 1 6 8zM8 10.500v3M6.500 12h3M15.500 11v.01M17.500 13v.01",
  "🔎": "M10.500 4a6.500 6.500 0 1 0 0 13a6.500 6.500 0 0 0 0-13zM15.300 15.300L20 20",
};

export function Glyph({ e, spoken = false, className = "h-[1.15em] w-[1.15em]" }: { e: string; spoken?: boolean; className?: string }) {
  // "⚖️" and "⚖" are the same icon: the variation selector only asks for the colour drawing.
  const d = PATHS[e.replace(/️/g, "")];
  if (!d) return spoken ? <span>{e}</span> : <span aria-hidden>{e}</span>;
  return (
    <>
      {spoken ? <span className="sr-only">{e}</span> : null}
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`inline-block shrink-0 align-[-0.18em] ${className}`}>
        <path d={d} />
      </svg>
    </>
  );
}
