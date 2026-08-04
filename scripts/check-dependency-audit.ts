type Severity = "high" | "critical";

interface AuditAdvisory {
  severity: string;
  title: string;
  url: string;
}

interface AcceptedAdvisory {
  id: string;
  package: string;
  severity: Severity;
}

interface AuditBaseline {
  acceptedAdvisories: AcceptedAdvisory[];
  auditLevel: Severity;
  reviewedAt: string;
}

interface Observation extends AcceptedAdvisory {
  title: string;
}

const baselinePath = new URL(
  "../.github/dependency-audit-baseline.json",
  import.meta.url
);
const baseline = (await Bun.file(baselinePath).json()) as AuditBaseline;
const audit = Bun.spawnSync(
  [process.execPath, "audit", "--json", `--audit-level=${baseline.auditLevel}`],
  {
    stderr: "pipe",
    stdout: "pipe",
  }
);
const stdout = audit.stdout.toString().trim();
const validExitCode = audit.exitCode === 0 || audit.exitCode === 1;

if (!(validExitCode && stdout)) {
  process.stderr.write(audit.stderr);
  throw new Error(`bun audit failed with exit code ${audit.exitCode}.`);
}

const report = JSON.parse(stdout) as Record<string, AuditAdvisory[]>;
const observations: Observation[] = Object.entries(report).flatMap(
  ([packageName, advisories]) =>
    advisories
      .filter(
        (advisory): advisory is AuditAdvisory & { severity: Severity } =>
          advisory.severity === "high" || advisory.severity === "critical"
      )
      .map((advisory) => ({
        id: advisory.url.split("/").at(-1) ?? advisory.url,
        package: packageName,
        severity: advisory.severity,
        title: advisory.title,
      }))
);

const severityRank: Record<Severity, number> = { high: 1, critical: 2 };
const accepted = new Map(
  baseline.acceptedAdvisories.map((advisory) => [
    `${advisory.package}:${advisory.id}`,
    advisory,
  ])
);
const observedKeys = new Set<string>();
const regressions: string[] = [];

for (const observation of observations) {
  const key = `${observation.package}:${observation.id}`;
  observedKeys.add(key);
  const expected = accepted.get(key);
  if (!expected) {
    regressions.push(
      `new ${observation.severity}: ${observation.package} ${observation.id} — ${observation.title}`
    );
  } else if (
    severityRank[observation.severity] > severityRank[expected.severity]
  ) {
    regressions.push(
      `severity increased: ${observation.package} ${observation.id} (${expected.severity} → ${observation.severity})`
    );
  }
}

const counts: Record<Severity, number> = { high: 0, critical: 0 };
for (const observation of observations) {
  counts[observation.severity] += 1;
}

if (regressions.length > 0) {
  console.error("Dependency advisory baseline regressed:");
  for (const regression of regressions) {
    console.error(`- ${regression}`);
  }
  console.error(
    "Review the dependency path and update .github/dependency-audit-baseline.json only when explicitly accepting the risk."
  );
  process.exit(1);
}

const resolved = baseline.acceptedAdvisories.filter(
  (advisory) => !observedKeys.has(`${advisory.package}:${advisory.id}`)
);
console.log(
  `Dependency audit passed against the ${baseline.reviewedAt} advisory allowlist: ${counts.critical} critical, ${counts.high} high observations across ${observedKeys.size} advisory IDs.`
);
if (resolved.length > 0) {
  console.log(
    `${resolved.length} accepted advisories are no longer reported; remove their baseline entries after verifying the dependency update.`
  );
}
