# Phases as spans — design

**Date:** 2026-08-24
**Status:** approved in principle; this is the written form for review.

Three user-reported problems drive this, and together they change the model
rather than patch it.

1. A Challenge cannot be ended. `startChallenge` stamps today and every later
   day inherits it, and no `endChallenge` exists anywhere. Once started it runs
   forever. This is unrecoverable state, not a missing button.
2. Maintenance carries no behaviour. Seven references outside tests across five
   files, none of which read it to decide anything. It is a label and a colour.
3. Ending an Elimination leaves the End button live for the rest of that day,
   because `endedOn = today` keeps today inside the span, so `eliminationStatus`
   still answers `running`.

A fourth requirement arrived with the first: a Challenge must record **what** is
being challenged, as free text.

## Why the model changes

`PhaseLedger.elimination` is a *single* record, so `days: Record<dateKey, Phase>`
is what preserves history — it is how a finished elimination keeps its colour
after a new one starts.

That map cannot hold a challenge's label. A `Record<dateKey, Phase>` has nowhere
to put "dairy", and a single `challenge` record would lose the label the moment a
second challenge began — which defeats the feature. So challenges must be a
list, and once they are, `days` and the list are two representations of the same
history that have to agree.

The coherent end state is spans only.

## The shape

```ts
export type Phase = "none" | "elimination" | "challenge";   // maintenance removed

/**
 * One run of a phase. A discriminated union rather than optional fields, so a
 * challenge without its label is a compile error rather than a blank chip.
 */
export type PhaseSpan =
  | { id: string; kind: "elimination"; startDate: string; plannedDays: number; endedOn: string | null }
  | { id: string; kind: "challenge";   startDate: string; what: string;        endedOn: string | null };

export interface PhaseLedger {
  /** Every phase ever run, in start order. Open spans have `endedOn: null`. */
  spans: PhaseSpan[];
}
```

`days`, `materialisedThrough` and the single `elimination` record are deleted.

## Reading a day

`phaseOnDate(ledger, dateKey, todayKey)` finds the span containing `dateKey` and
returns its `kind`, or `"none"`.

A span's last day is `endedOn` when set. Otherwise it is the planned last day for
an elimination (`startDate + plannedDays - 1`), and unbounded for an open
challenge, which runs until ended.

**Both are clamped to `todayKey`.** Nothing beyond today is ever coloured, which
preserves today's behaviour — the materialiser only ever stamped up to today, so
a running elimination does not pre-colour its remaining days. This is why the
function takes `todayKey`: it is the one piece of state a pure span lookup cannot
derive.

An elimination whose planned last day has passed is closed *by computation*. No
write is needed to end it, which is what removes the need for a materialiser at
all.

**CORRECTED 2026-08-24 — "closed" and "not open" are two questions, and this
sentence only answered one of them.** `spanOnDate` computes a span's last day
from `plannedDays`, so an elapsed elimination correctly covers no day. But
`openSpan` asked only whether `endedOn` is null, and nothing writes `endedOn`
when a plan merely runs out — so a completed elimination stayed "open" forever.
The card read "Nothing running" while both mutators threw and the start sheet
greyed out every phase: a permanent lockout with no route out.

`openSpan` therefore takes `todayKey` and means **still open today**: `endedOn`
is null AND the span has not run out — for an elimination, its planned last day
is not before today; for a challenge, always, since it has no planned length and
runs until ended. A scheduled elimination is still open, its planned end being
later still.

The fix is deliberately not "write `endedOn` when a plan elapses". That would
reintroduce a write on app open, which is the materialiser this rework exists to
delete.

Two consequences of the new `todayKey` argument, both easy to miss:

`phaseOfRecord` keeps its job unchanged — the ledger is authoritative for a
day's phase and a log's stored copy is only the fallback. It must keep using an
explicit `"none"` check rather than `??`, because `"none"` is not nullish and
that exact bug shipped here once.

Every mutator that stamps `phase` onto a new log calls `phaseOnDate` and so now
needs `todayDateKey` as well as the log's date. That is `addConsumptionLog(s)`,
`addSymptomLog`, `addScratchLog` and `updateScratchLog`. AppContext already
holds `todayDateKey`, so this is a threading change, not new state — but it
touches every log-writing path, which makes it the riskiest mechanical part of
the work.

## What this deletes

`materialise`, `walkFrom`, `phaseForDay` and its inheritance rule, the `days`
map, `materialisedThrough`, `lib/ledgerSync.ts` and its tests, and the ledger
write in AppContext's midnight effect. The `todayDateKey` refresh in that effect
stays — other screens depend on it; only the ledger write goes.

It also removes the parked "ledger grows forever" problem outright. Maintenance
was the unbounded part: one entry per day for the rest of time. Spans are
bounded by how many phases you actually run.

## Rules preserved

- One open span at a time. Starting either phase while one is open is refused —
  the existing rule 4, generalised from elimination to both.
- An elimination may still be scheduled to start on a future date.
- Ending early shortens the span; it does not delete it.

## How the three problems resolve

**Ending a Challenge** is `endChallenge(ledger, todayKey)`, setting `endedOn` on
the open challenge — the mirror of `endEliminationEarly`.

**Maintenance** leaves the `Phase` union, `PHASE_COLORS` and the export's phase
column. Because every colour map is `Record<Phase, string>`, removing the member
makes tsc find every site.

**The stale End button** goes, and only it.

**CORRECTED 2026-08-24.** The first version of this section said `phaseStatus`
should ask "is there an *open* span", so an ended span reports `none`. That is
wrong, and it contradicts the behaviour that was actually chosen: the card was
to keep reading `Elimination · Day 4 of 4` for the rest of that day with only
the pencil removed. Asking about the open span makes the card read "Nothing
running" the instant you press End, so the day's colour on the calendar and the
card disagree — exactly the split the choice was made to avoid.

`phaseStatus` therefore reports on the span **covering today**, open or ended
today, and carries `canEnd: boolean` — true only while `endedOn` is null. The
card renders from the status; the pencil and the edit modal are gated on
`canEnd`. A span ended *yesterday* covers no part of today and still reports
`none`.

This also makes the ended-early shortening live rather than dead code: an
elimination ended on day 4 of a planned 14 reports `totalDays: 4` and
`progress: 1`, so "last day" sits above a full bar instead of a stale 29%.

## Migration

None. There is no data, which is why this is being done now rather than later.

The load path must still tolerate an old-shaped ledger on disk — an object with
`days` and no `spans` — by falling back to the empty ledger. **This must not go
through `runSchemaMigration`:** bumping `CURRENT_SCHEMA_VERSION` re-fires the
wipe that deletes consumption, symptom, scratch and custom-food storage. A shape
check on load is the whole of it.

## UI

`PhaseStartModal` gains a free-text field for a challenge, "What are you
challenging?". **Required** — Start stays disabled while it is blank, because an
unlabelled challenge is exactly the record the analysis cannot use.

`PhaseStatusCard` shows the open span, reading `Challenge · dairy` where a label
exists. `PhaseEditModal` offers End for whichever kind is open, titled to match.

## Backup

`isEmptyLedger` becomes `spans.length === 0`. The ledger stays a single document
with local-wins on merge, unchanged. The exhaustive collection table is
untouched — this changes the ledger's shape, not the set of collections.

## Testing

`lib/phases.ts` is pure and already well covered; its tests are rewritten
against spans rather than extended. The cases that must survive in some form:
the start date reading as Day 1, the last planned day, the day after, a
cancelled schedule, and a day outside every span reading `"none"` rather than
null.

New cases the span model needs: two spans back to back; a gap between spans
reading `"none"`; an open challenge covering today but not tomorrow; an
elimination whose planned end has passed reading closed without a write; and a
refusal when a second span is started while one is open.

Every guard added here gets a mutation check before it is called done — five
guards on the last branch turned out to pin nothing, and each was found this way
rather than by reading.

## Out of scope

Per-log challenge ids. The analysis guide notes challenge episodes are not
grouped, but with spans carrying dates and labels, an analyst joins logs to
challenges by date. Adding a `challenge_id` to every consumption log is a
data-model change that this does not need.
