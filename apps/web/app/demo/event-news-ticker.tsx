"use client";

import Link from "next/link";
import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { EVENT_NEWS } from "./event-news";
import "./event-news-ticker.css";

export function EventNewsTicker() {
  const [paused, setPaused] = useState(false);

  return (
    <div className="event-news-ticker" aria-label="PRIMUS event news ticker" role="region">
      <span className="event-news-label" aria-hidden="true">Event news</span>
      <Link href="/demo/newsroom" className="event-news-window" aria-label="Read event news">
        <span className="event-news-belt" data-paused={paused} aria-hidden="true">
          {[0, 1].map((copy) => (
            <span className="event-news-set" key={copy}>
              {EVENT_NEWS.map((story) => (
                <span className="event-news-headline" key={story.time}>
                  <span className="event-news-time">{story.time} IST</span>
                  <strong>{story.type}</strong>
                  <span>{story.title}</span>
                </span>
              ))}
            </span>
          ))}
        </span>
      </Link>
      <button type="button" className="event-news-toggle" aria-label={paused ? "Resume news ticker" : "Pause news ticker"} onClick={() => setPaused(!paused)}>
        {paused ? <Play aria-hidden="true" size={15} /> : <Pause aria-hidden="true" size={15} />}
      </button>
    </div>
  );
}
