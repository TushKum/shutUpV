// Tiny --flag value parser for the operator scripts.

export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const [key, inline] = a.slice(2).split("=", 2) as [string, string | undefined];
    if (inline !== undefined) out[key] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) out[key] = argv[++i]!;
    else out[key] = true;
  }
  return out;
}

export function required(env: string): string {
  const v = process.env[env];
  if (!v) throw new Error(`environment variable ${env} is required`);
  return v;
}
