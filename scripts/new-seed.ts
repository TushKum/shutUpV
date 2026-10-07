// The day before the event: make the secret lottery seed and the commitment to publish.
//
//   pnpm new-seed
//
// Keep the seed secret (an organiser's password manager); publish the commitment, and enter it in /admin or with
// `pnpm seed --commitment …` while the event is still in SETUP (it is fixed once the event starts). At 21:00 enter
// the seed and the dice roll; the seed is revealed at the crisis so anyone can check every draw.

import { randomBytes } from "node:crypto";
import { sha256Hex } from "@msim/engine";

const seed = randomBytes(32).toString("hex");
console.log(`Secret seed (keep private until 00:30): ${seed}`);
console.log(`Commitment (publish now):              ${sha256Hex(seed)}`);
