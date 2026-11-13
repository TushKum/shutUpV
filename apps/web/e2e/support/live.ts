// How long a big-screen test waits for an organiser's action to show up live: the broadcast, then the screen's
// re-read. That takes a second or two on an idle machine; the full suite shares one local database with other
// specs, so allow for a loaded one. The screen re-reads by itself only every 10 s while its channel is down and once
// a minute while it is live, so a pass within this time still comes from the live update.
export const LIVE = { timeout: 15_000 } as const;
