/**
 * Every option `ramonda-check` takes, with what `--help` says about it — one list, read by the
 * command's parser and its help, and by the docs' test that `/reference/check` names each one.
 */
export const OPTIONS: readonly (readonly [flag: string, takes: string, what: string])[] = [
  ["--graph", "<file>", "also write the composition graph the checks are computed from, as JSON"],
  ["--graph-html", "<file>", "the same graph as one self-contained page"],
  ["--diff", "<graph.json>", "compare this run against a graph written earlier"],
  ["--split", "", "say what the browser loads first and what each lazy piece brings"],
  ["--fix", "", "write the fixes that have exactly one answer; everything else is still reported"],
  ["--dry-run", "", "with --fix: say what it would write, and write nothing"],
  ["--certify", "", "print what this package can and cannot claim about the graph it ships"],
  ["--help", "", "print this and exit (also -h)"],
  ["--version", "", "print the version and exit (also -v)"],
];
