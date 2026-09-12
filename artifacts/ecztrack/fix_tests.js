const fs = require('fs');
const files = ['lib/backup.test.ts', 'lib/phaseLabels.test.ts', 'lib/phases.test.ts'];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  // Fix literal objects: { id: "e1", kind: "elimination", startDate: ..., plannedDays: ... }
  // We insert `what: "dairy", ` after `startDate: ..., `
  content = content.replace(/(kind:\s*"elimination",\s*startDate:\s*[^,]+,)/g, '$1 what: "dairy",');
  
  // Fix scheduleElimination calls: scheduleElimination(ledger, "2026-05-01", 14, "2026-05-01", ...)
  // The old signature was: scheduleElimination(ledger, start, days, today, newId)
  // We change it to: scheduleElimination(ledger, start, days, today, "dairy", newId)
  // Wait, newId is usually `() => "e2"` or similar.
  // It's safer to just replace `scheduleElimination(` and then carefully insert the argument. Let's look at the actual calls.
  fs.writeFileSync(file, content);
}
