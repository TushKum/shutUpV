// Three team portals from one app. Each deployment sets TEAM_PORTAL (PRODUCT, CONSULTING or FINANCE) and then admits
// only that track's teams and shows only that track's pages; with no TEAM_PORTAL the deployment admits every team (the
// organisers' and the rehearsal deployment). Organisers can sign in on every portal. PORTAL_URL_<TRACK> (optional)
// names where the other tracks sign in, so a team at the wrong door is sent to the right one.

import { TRACK_LABELS, TRACKS, type Track } from "@msim/engine";

export function parsePortal(value: string | undefined): Track | null {
  const v = value?.trim().toUpperCase();
  return v && (TRACKS as readonly string[]).includes(v) ? (v as Track) : null;
}

/** This deployment's track, or null when it serves every track. */
export function teamPortal(): Track | null {
  return parsePortal(process.env.TEAM_PORTAL ?? process.env.NEXT_PUBLIC_TEAM_PORTAL);
}

/** May a team of this track use this deployment? */
export function portalAdmits(portal: Track | null, track: Track): boolean {
  return portal === null || portal === track;
}

/** The sign-in address of another track's portal, when the deployment knows it. */
export function portalUrl(track: Track): string | null {
  const url = process.env[`PORTAL_URL_${track}`]?.trim();
  return url && /^https:\/\//.test(url) ? url.replace(/\/+$/, "") : null;
}

export const PORTAL_TITLES: Record<Track, string> = {
  PRODUCT: "Product portal",
  CONSULTING: "Consulting portal",
  FINANCE: "Finance portal",
};

/** What a team at the wrong portal is told. */
export function wrongPortalMessage(portal: Track, track: Track, url: string | null): string {
  return (
    `This is the ${PORTAL_TITLES[portal]}, for ${TRACK_LABELS[portal]} teams only. ` +
    `${TRACK_LABELS[track]} teams sign in on the ${PORTAL_TITLES[track]}` +
    (url ? ` at ${url}.` : ".")
  );
}
