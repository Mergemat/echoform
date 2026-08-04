# TODOs

## Remove accepted dependency advisories

Upgrade or replace the remaining transitive dependency paths as compatible fixes
become available. The reviewed package/advisory IDs are tracked in
`.github/dependency-audit-baseline.json`; run `bun run audit` after dependency
updates and remove resolved entries from the baseline.
