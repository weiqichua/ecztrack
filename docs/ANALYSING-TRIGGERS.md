# Finding your eczema triggers from the JSON export

This is a working guide for the one person whose data this is. It is not a
machine-learning tutorial, and it deliberately spends more time on what the data
*cannot* tell you than on model selection, because that is where this problem is
actually hard.

The honest summary, up front:

> Your logs can **rank suspects**. They cannot **confirm a trigger**. Confirmation
> is a deliberate reintroduction test, which is what the Challenge phase is for.
> Everything below exists to make that shortlist as short and as well-ordered as
> possible.

---

## Getting set up

Skip this if you already have a Python environment you like. Nothing here is
specific to the analysis; it is the part that is tedious to work out twice.

### 1. Get the file out of the app

Open the **Export** tab and choose **Full Dataset — JSON**. What happens next
depends where you are running the app:

- **In a browser** — it downloads as `health_tracker_full_<date>.json`, wherever
  your browser puts downloads.
- **On the phone** — it opens the system share sheet. AirDrop it, mail it to
  yourself, or save it to Files; anything that gets it onto the machine you will
  analyse on.

Make a folder to work in and put the file in it. The rest of this guide assumes
the file sits beside the scripts:

```bash
mkdir -p ~/eczema-analysis && cd ~/eczema-analysis
mv ~/Downloads/health_tracker_full_*.json ./export.json
```

Re-export whenever you want fresher data. The file is a snapshot, not a
connection — nothing updates it in place.

### 2. Decide where to run it

**Run it locally.** This is your medical history: symptom severity, body
locations, what you eat, how often you scratch. A hosted notebook —
Google Colab, Kaggle, a shared JupyterHub — means uploading that file to
someone else's computer, where it is subject to their retention and their
account security. There is no analytical reason to do that here. The dataset is
a few hundred rows and runs faster on a laptop than it takes Colab to boot.

If you do use a hosted notebook anyway, know that you are making that trade
deliberately, and delete the uploaded file afterwards.

Locally, any of these is fine:

- **JupyterLab** — best for this kind of work, because you will re-run the same
  block against different foods dozens of times.
- **VS Code** — open the folder and use a `.ipynb`, or run the `.py` files with
  the Python extension's interactive window.
- **Plain scripts** — the code blocks below are written as runnable `.py` files
  and work with `python load.py` and so on. Least convenient for iterating, but
  it works.

### 3. Install what the guide uses

Python 3.10 or newer. Use a virtual environment so this does not collide with
anything else on your machine:

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install pandas numpy statsmodels scikit-learn matplotlib jupyterlab
```

That covers everything except the optional Bayesian route in §4.5, which needs
`pip install bambi` and takes a while to compile on first use. Leave it until
you actually want it.

Then, if you are using JupyterLab:

```bash
jupyter lab
```

### 4. How the code blocks fit together

The blocks are named after the file they belong in — `load.py`, `features.py`,
`screen.py`, `enet.py` — and they run in that order, each expecting the previous
one's dataframe. In a notebook, one block per cell, top to bottom, is the same
thing.

Start by running this to confirm the file is what you think it is. If any of it
surprises you, stop and work out why before running anything else — every number
later in this guide inherits whatever is wrong here.

```python
import json

raw = json.loads(open("export.json").read())

print("schema version:", raw.get("schema_version"))
print("scale:", raw.get("symptom_scale"))
print("exported:", raw.get("exported_at"))
print()
print("check-ins:      ", len(raw.get("symptom_logs", [])))
print("food events:    ", len(raw.get("consumption_logs", [])))
print("urges:          ", len(raw.get("urge_logs", [])))
print("phase spans:    ", len(raw.get("phase_ledger", {}).get("spans", [])))
print("symptoms:       ", [s["name"] for s in raw.get("symptoms", [])])
print("food tags:      ", [t["name"] for t in raw.get("food_tags", [])])
print("supplements:    ", [s["name"] for s in raw.get("supplements", [])])
print("activities:     ", [a["name"] for a in raw.get("activities", [])])
```

Two things to check in that output. `symptom_scale` should say
`direction: "higher_is_worse"` — if it is absent, the export predates the scale
flip and its scores mean the opposite of everything below. And the check-in
count is the number that decides whether any of this is worth running: under
about sixty days, read §3, look at the descriptive numbers, and come back when
you have more.

---

## 0. What you are working with

Take **Full Dataset — JSON** from the Export tab. It is built by `buildJSON` in
`lib/exportCsv.ts` and has exactly this shape:

```jsonc
{
  "exported_at": "2026-08-29T04:11:07.512Z",
  "schema_version": 4,                       // a NUMBER, from lib/migrations.ts
  "symptom_scale": { "min": 1, "max": 5, "direction": "higher_is_worse" },
  "phase_ledger": { "spans": [
      { "id","kind":"elimination","startDate","plannedDays","endedOn": null },
      { "id","kind":"challenge",  "startDate","what":"cow's milk","endedOn" } ] },

  // The catalogs every id in the file resolves against.
  "symptoms":        [ { "id","name","order","isArchived" } ],
  "body_locations":  [ … ],
  "cues":            [ … ],
  "routines":        [ { …, "description" } ],
  "food_categories": [ … ],
  "food_tags":       [ { …, "icon" } ],
  "supplements":     [ { "id","name","isArchived" } ],
  "activities":      [ { "id","name","isArchived" } ],

  "consumption_logs":[ { "id","timestamp","date","item_id","phase",
                         "is_accident",
                         "portion": "small"|"medium"|"large",   // key may be ABSENT
                         "group_id",                            // key may be ABSENT
                         "meal",                                // key may be ABSENT, e.g. "Meal"
                         "food": { "id","name","category","tags":{ "<tagId>": 0|1 },
                                   "tag_intensity":{ "<tagId>": 1|2|3 },  // key may be ABSENT; pruned to carried tags
                                   "is_elimination_safe","isArchived" } | null } ],
  "supplement_logs": [ { "id","timestamp","date","item_id","phase" } ],
  "activity_logs":   [ { "id","timestamp","date","item_id","phase","intensity" } ],
  "symptom_logs":     [ { "id","date","phase","scores": { "<symptomId>": 1-5 | null } } ],
  "urge_logs":        [ { "id","timestamp","date","phase","location","cue",
                          "routine_id","success":1-4,"is_accident" } ],
  "habit_definitions":[ { "id","name","icon","unit","goal","order","isArchived" } ],
  "habit_logs":       [ { "id","habitId","date","value" } ]
}
```

Nine things about this shape that will bite you if you assume otherwise.

**Symptom scores read HIGH = severe**, and the file now says so. 1 means no
symptoms, 5 means as bad as it gets (`lib/scoreScale.ts`), so a *rising* number
is a *worsening* day. The app originally ran the other way round and was flipped
on 2026-08-24; two exports either side of that are identical in shape and
opposite in meaning. `symptom_scale.direction` is what tells them apart. An
export saved before that field existed has no `symptom_scale` key at all — treat
its scores as suspect and check them against a week you remember.

**Every event carries its `date`.** `buildJSON` stamps `localDateKey(timestamp)`
onto every consumption and urge log, so the day the app filed the event under is
in the file. Use it. Do not slice `timestamp[:10]` — that is the UTC day, which
disagrees with the app for part of every 24 hours, and in UTC+8 misfiles
everything logged before 08:00. The one caveat is that `date` is computed on the
device *at export time*, so an export taken abroad files by that zone; it is
still one consistent calendar across the file, which the timestamp alone is not.

**`null` and "absent" are different things.** A `null` score means the box was
shown and deliberately left blank. A *missing key* means that symptom did not
exist on that log at all — you created it later, or archived it since. Do not let
`.fillna()` erase that distinction. `portion` follows the same rule one level
down, and it matters more there: see below.

**A log can exist with every score `null`.** That is not a check-in; it is a day
you tapped a box and tapped it off again. Note that the JSON is *not* filtered
for you — `buildJSON` emits `symptom_logs` raw, where `buildSymptomCSV` drops
these rows. Apply `isRecordedCheckin`'s rule yourself or you get phantom days.

**Ids resolve to names from the file itself.** `symptoms`, `body_locations`,
`cues`, `routines`, `food_categories` and `food_tags` are all exported, so
`scores` keys, urge locations and a food's category and tags all have names
without any hand-mapping. Archived items are included, which is the point — a
log holding a retired symptom's id still renders. Two things are *not* catalogs:
foods appear only nested inside consumption logs, so a food you never ate is
absent from the export entirely, and `food.category` / the keys of `food.tags`
are **ids**, which for the seeded vocabulary happen to equal their names
(`"dairy"`, `"Grains"`) but for anything you created yourself will not.

**Portion is optional and its absence is information.** `ConsumptionLog.portion`
is written only when you actually tapped a size (`lib/foodLog.ts` omits the key
otherwise, deliberately). **Never impute a missing portion as "medium."** It is
not a middle value; it is no value, and filling it puts a guess in the middle of
a three-level scale where it will outnumber and swamp the two real levels either
side. §2 covers how to use it and §7 covers why the recorded rows are a biased
sample.

**A meal is a display grouping, not a new unit of analysis.** `group_id` is
stamped onto every log written in one Save, and `meal` is that save's name —
`"Meal"` by default, renamable afterwards. Logs written after 2026-08-31 carry
both keys; an older log gains both the first time its meal is renamed in the
app. What cannot occur is a meal name without a group id. Nothing about the
row changes: it is still one food eaten at one time, and every feature in §2
keeps treating it that way. `group_id` is useful only if you deliberately want to
model a meal as a co-exposure set — several foods eaten together — rather than as
independent events; the simpler and default choice is to ignore it. Do not key
anything on `meal`'s text either. It is a label the user typed, not a category,
and two logs reading "Dinner" are not guaranteed to be the same kind of meal.

**`food.tag_intensity` grades how strong a tag is, and absent means ungraded —
not average.** Where present, it is `{"<tagId>": 1|2|3}` for Low, Average, High,
and only for the tags `food.tags` actually has set to 1 — a tag switched off
after being graded loses the grade rather than keeping a stale one. Where a tag
has never been graded, the key for it is simply missing. The app computes with
an implicit 2 in that case (see §2), but the export deliberately does not write
that default in, for the same reason `portion` above is never filled with
"medium": a written 2 would be a judgement the user never made, and nothing
reading the file could tell it apart from a real one. The CSV drops columns
for archived tags, but the JSON's `food.tag_intensity` still carries grades for
them — filter by the tags actually set in that food's `tags` object if that
matters to your analysis.

**Skin photos are not in this file, and there is no way to export them.**
They are not in the Firebase backup either — they live on the phone and stay
there. Nothing below can see them, so if a flare's appearance matters to a
question you are asking, that part is eyes-on-the-phone work alongside the
numbers, not something you can join to a row here.

---

## 1. Loading and reshaping

```bash
pip install pandas numpy statsmodels scikit-learn matplotlib
```

The unit of analysis is a **day**. Food arrives as timestamped events, symptoms as
one check-in per day, so everything has to be aggregated up to a daily grid.

```python
# load.py
import json, numpy as np, pandas as pd

PORTION_RANK = {"small": 1, "medium": 2, "large": 3}


def span_last_day(span, today):
    """Mirrors spanLastDay in lib/phases.ts.

    An elimination whose planned run has elapsed is over BY COMPUTATION — no
    `endedOn` is ever written for it — so reading `endedOn is None` as "still
    running" would colour every day since as elimination. Both open kinds clamp
    at today so nothing in the future gets a phase.
    """
    if span.get("endedOn"):
        return span["endedOn"]
    if span["kind"] == "elimination":
        planned = (pd.Timestamp(span["startDate"])
                   + pd.Timedelta(days=span["plannedDays"] - 1)).strftime("%Y-%m-%d")
    else:
        planned = today
    return min(planned, today)


def spans_covering(ledger, day, today):
    return [s for s in (ledger.get("spans") or [])
            if s["startDate"] <= day <= span_last_day(s, today)]


def phase_on(ledger, day, today):
    """The phase of a day: the LATEST-STARTING span covering it, else "none".

    Two spans can own one day — ending an elimination and starting a challenge
    the same day is the ordinary next step — and lib/phases.ts resolves that to
    the later start, with a tie going to the later entry in the list. Taking the
    first match instead reads the day as elimination and hides the challenge.
    "none" is a real state, not a missing value.
    """
    best = None
    for s in spans_covering(ledger, day, today):
        if best is None or s["startDate"] >= best["startDate"]:
            best = s
    return best["kind"] if best else "none"


def load_export(path):
    with open(path) as fh:
        raw = json.load(fh)

    # The tag vocabulary is USER-OWNED: `food.tags` is a map keyed by catalog id,
    # not a fixed set of columns. Hardcoding a list silently drops every tag you
    # added and every one you renamed the id of.
    tag_ids  = [t["id"] for t in raw.get("food_tags", [])]
    names    = lambda key: {i["id"]: i["name"] for i in raw.get(key, [])}
    catalogs = {k: names(k) for k in
                ("symptoms", "body_locations", "cues", "routines",
                 "food_categories", "food_tags", "supplements", "activities")}

    cons = pd.DataFrame(raw.get("consumption_logs", []))
    if not cons.empty:
        # `date` is stamped by the exporter in the local calendar. Not derived.
        cons["date"] = pd.to_datetime(cons["date"])
        # `food` is nested per log, and is null when the food record is gone.
        cons["food_name"] = cons["food"].map(lambda f: f["name"] if f else None)
        cons["category"]  = cons["food"].map(lambda f: f["category"] if f else None)
        for t in tag_ids:
            cons[f"tag_{t}"] = cons["food"].map(
                lambda f, t=t: (f.get("tags") or {}).get(t, 0) if f else 0).astype(int)
            # 1-3 where graded, NaN where not — never filled here, for the same
            # reason `tag_{t}` itself is never treated as a grade. An export from
            # before intensity existed has no `tag_intensity` key on any food, so
            # every one of these columns comes back all-NaN, which is correct.
            cons[f"tag_{t}_intensity"] = cons["food"].map(
                lambda f, t=t: (f.get("tag_intensity") or {}).get(t) if f else None)
        cons["food_name"] = cons["food_name"].fillna(cons["item_id"])
        # Absent = unrecorded, and it stays NaN. Mapping through PORTION_RANK
        # rather than filling keeps "eaten, size unknown" out of every average
        # a filled column would quietly enter.
        if "portion" not in cons.columns:
            cons["portion"] = None
        cons["portion_rank"] = cons["portion"].map(PORTION_RANK)

    sym = pd.DataFrame(raw.get("symptom_logs", []))
    if not sym.empty:
        sym["date"] = pd.to_datetime(sym["date"])
        # The JSON, unlike the symptom CSV, is unfiltered. A log whose every
        # score is null records nothing (lib/dayStyle.ts isRecordedCheckin) —
        # a box tapped on and tapped off again.
        sym["recorded"] = sym["scores"].map(
            lambda s: any(v is not None for v in (s or {}).values()))

    urge = pd.DataFrame(raw.get("urge_logs", []))
    if not urge.empty:
        urge["date"] = pd.to_datetime(urge["date"])

    supp = pd.DataFrame(raw.get("supplement_logs", []))
    if not supp.empty:
        supp["date"] = pd.to_datetime(supp["date"])
        supp["name"] = supp["item_id"].map(catalogs.get("supplements", {}))

    act = pd.DataFrame(raw.get("activity_logs", []))
    if not act.empty:
        act["date"] = pd.to_datetime(act["date"])
        act["name"] = act["item_id"].map(catalogs.get("activities", {}))

    hlog = pd.DataFrame(raw.get("habit_logs", []))
    if not hlog.empty:
        hlog["date"] = pd.to_datetime(hlog["date"])
    hdef = {h["id"]: h for h in raw.get("habit_definitions", [])}

    return dict(raw=raw, cons=cons, sym=sym, urge=urge, supp=supp, act=act, hlog=hlog, hdef=hdef,
                ledger=raw.get("phase_ledger") or {"spans": []},
                tag_ids=tag_ids, catalogs=catalogs,
                # "Today" for clamping open spans is the day the file was written,
                # not the day you run this — otherwise an open challenge grows a
                # tail of phase days that have no logs in the export at all.
                today=raw["exported_at"][:10],
                scale=raw.get("symptom_scale"))


def build_daily(d):
    cons, sym, urge, hlog, hdef = d["cons"], d["sym"], d["urge"], d["hlog"], d["hdef"]
    ledger, today, tag_ids = d["ledger"], d["today"], d["tag_ids"]

    if d["scale"] and d["scale"]["direction"] != "higher_is_worse":
        raise ValueError("This export uses the pre-flip scale; every sign below inverts.")

    # Spine over EVERY calendar day, not just days with a check-in: a missed day
    # is data (see `checked_in`), and indexing on logged days alone would make
    # "yesterday" mean "the previous day I happened to log", breaking every lag.
    starts = [s["date"].min() for s in (cons, sym, urge, hlog) if not s.empty]
    ends   = [s["date"].max() for s in (cons, sym, urge, hlog) if not s.empty]
    idx = pd.date_range(min(starts), max(ends), freq="D", name="date")
    df = pd.DataFrame(index=idx)

    # Phase: the ledger is authoritative and a day in no span is a real "none"
    # (lib/phases.ts). The `phase` stamped on a log is a denormalised copy taken
    # at write time and can be stale, so it is only a fallback — and only where
    # the ledger says "none", never as an override, since "none" is not nullish.
    df["phase"] = [phase_on(ledger, t.strftime("%Y-%m-%d"), today) for t in idx]
    if not sym.empty and "phase" in sym.columns:
        fb = sym.set_index("date")["phase"].reindex(idx)
        need = df["phase"].eq("none") & fb.notna() & fb.ne("none")
        df.loc[need, "phase"] = fb[need]

    # Symptoms. Absent key = symptom did not exist yet; explicit null = shown and
    # left blank. Both become NaN, so `offered_*` preserves the difference.
    sym_ids = []
    if not sym.empty:
        for s in sym.loc[sym["recorded"], "scores"]:
            for k in (s or {}):
                if k not in sym_ids: sym_ids.append(k)
        rec = sym.loc[sym["recorded"]].set_index("date")
        for sid in sym_ids:
            df[f"sym_{sid}"] = rec["scores"].map(lambda s, k=sid: s.get(k)).reindex(idx)
            df[f"offered_{sid}"] = (rec["scores"].map(lambda s, k=sid: k in (s or {}))
                                    .reindex(idx).eq(True))
        df["checked_in"] = df.index.isin(rec.index)
        # Mean over the symptoms each day actually scored — mirrors symptom_avg in
        # buildSymptomCSV, so a symptom you added in month 4 cannot drag the series.
        df["sym_mean"] = df[[f"sym_{s}" for s in sym_ids]].mean(axis=1, skipna=True)
    else:
        df["checked_in"], df["sym_mean"] = False, np.nan

    # Food exposure: binary "ate it" plus a count, per food, per tag, per category.
    food_names = {}
    if not cons.empty:
        food_names = cons.drop_duplicates("item_id").set_index("item_id")["food_name"].to_dict()
        n = cons.pivot_table(index="date", columns="item_id", values="id",
                             aggfunc="count").reindex(idx).fillna(0)
        sized = cons.dropna(subset=["portion_rank"])
        dose = (sized.pivot_table(index="date", columns="item_id",
                                  values="portion_rank", aggfunc="max")
                if not sized.empty else pd.DataFrame(index=idx))
        for fid in n.columns:
            df[f"n_{fid}"], df[f"ate_{fid}"] = n[fid].astype(int), (n[fid] > 0).astype(int)
            # The day's LARGEST recorded portion, and NaN on any day the food was
            # not eaten or was eaten unsized. `max`, not `sum` or `mean`: two
            # logged smalls are not a large, and a mean would invent a size for
            # the unsized events beside them. Leaving it NaN is what keeps
            # "eaten, size unknown" out of the dose model rather than in the
            # middle of it.
            df[f"dose_{fid}"] = dose[fid].reindex(idx) if fid in dose.columns else np.nan
            df[f"unsized_{fid}"] = (df[f"ate_{fid}"] == 1) & df[f"dose_{fid}"].isna()
        for t in tag_ids:
            g = cons.groupby("date")[f"tag_{t}"].sum().reindex(idx).fillna(0)
            df[f"tagn_{t}"], df[f"tag_{t}"] = g.astype(int), (g > 0).astype(int)
        for cat in sorted(cons["category"].dropna().unique()):
            g = cons[cons["category"] == cat].groupby("date")["id"].count().reindex(idx).fillna(0)
            df[f"cat_{cat}"] = (g > 0).astype(int)
        df["n_food_events"] = cons.groupby("date")["id"].count().reindex(idx).fillna(0).astype(int)
        df["any_food_logged"] = df["n_food_events"] > 0
        # How many of the day's events carried a size. This is a MISSINGNESS
        # diagnostic, not a feature — see §3 and §7.
        df["n_sized"] = (cons.dropna(subset=["portion_rank"]).groupby("date")["id"]
                         .count().reindex(idx).fillna(0).astype(int))
        df["n_accident"] = (cons[cons["is_accident"]].groupby("date")["id"].count()
                            .reindex(idx).fillna(0).astype(int))

    if not urge.empty:
        df["n_urges"] = urge.groupby("date")["id"].count().reindex(idx).fillna(0).astype(int)
        df["urge_success_mean"] = urge.groupby("date")["success"].mean().reindex(idx)
    else:
        df["n_urges"], df["urge_success_mean"] = 0, np.nan

    if not hlog.empty:
        for hid, defn in hdef.items():
            v = hlog[hlog["habitId"] == hid].groupby("date")["value"].sum().reindex(idx)
            df[f"habit_{defn['name']}"] = v.fillna(0)

    df.attrs["symptom_ids"], df.attrs["food_names"] = sym_ids, food_names
    df.attrs["tag_ids"], df.attrs["catalogs"] = tag_ids, d["catalogs"]
    return df
```

`cons` now carries both `tag_<id>` and `tag_<id>_intensity` for every tag, and
anything that enumerates tag columns by scanning `cons.columns` for a `tag_`
prefix has to exclude the `_intensity` suffix, or a graded tag doubles as its own
binary flag:

```python
tag_cols = [c for c in cons.columns if c.startswith("tag_") and not c.endswith("_intensity")]
```

`tag_ids` above already sidesteps this by reading the catalog directly rather
than scanning columns, so prefer it; reach for the pattern above only in code
that genuinely needs to rediscover which columns are tags from the frame itself.

Symptom columns stay keyed by id, because ids are what survive a rename. Put the
names on only at the point you print something:

```python
sym_name = lambda sid: df.attrs["catalogs"]["symptoms"].get(sid, sid)
tag_name = lambda tid: df.attrs["catalogs"]["food_tags"].get(tid, tid)
```

`any_food_logged` matters more than it looks. A day with no food events is almost
never a day you did not eat — it is a day you did not *log*. Treating it as "ate
nothing" turns forgetfulness into a fake exposure contrast.

---

## 2. Feature engineering that respects the biology

Three things drive every choice here.

Reactions are **lagged** — Monday's dinner shows up Tuesday or Wednesday — so the
same-day column is usually the wrong one to test. Reactions are also
**persistent**, so today's score is mostly yesterday's score, and any model
without a lagged symptom term will hand that persistence to whatever you happened
to eat during a bad stretch. And your exposure matrix is **wide and short**, so
rare foods must be rolled up into their tags or categories.

```python
# features.py
import numpy as np, pandas as pd

def add_lags(df, exposures, target="sym_mean", max_lag=3):
    new = {}
    for c in exposures:
        s = df[c]
        for L in range(1, max_lag + 1):
            new[f"{c}__lag{L}"] = s.shift(L)
        # Windows EXCLUDE today (shift(1) before rolling), so the feature is
        # strictly the past. A window including today lets an effect precede
        # its cause, which is the single easiest way to fake a strong result.
        new[f"{c}__any1_3"] = s.shift(1).rolling(3, min_periods=1).max()
        new[f"{c}__sum1_3"] = s.shift(1).rolling(3, min_periods=1).sum()

    # Yesterday's score is the strongest single predictor of today's. Omitting it
    # credits foods for what is really just persistence.
    # ffill(limit=2) is deliberate: carrying a score across a longer gap invents
    # data for days you never checked in on.
    t = df[target]
    new[f"{target}__lag1"] = t.ffill(limit=2).shift(1)
    new[f"{target}__lag2"] = t.ffill(limit=2).shift(2)
    idx = df.index.to_series()
    new["days_since_checkin"] = idx.sub(idx.where(df["checked_in"]).ffill()).dt.days

    out = pd.concat([df, pd.DataFrame(new, index=df.index)], axis=1)
    out.attrs.update(df.attrs)
    return out


def exposure_report(df, food_names, min_days=15):
    """Counts first. A food eaten 4 times cannot support any claim."""
    rows = []
    for c in [c for c in df.columns if c.startswith("ate_")]:
        on = int(df[c].sum())
        rows.append({"feature": c, "name": food_names.get(c[4:], c[4:]),
                     "days_eaten": on, "days_not": len(df) - on})
    for c in [c for c in df.columns if c.startswith("tag_")]:
        on = int(df[c].sum())
        rows.append({"feature": c, "name": c[4:] + " (tag)",
                     "days_eaten": on, "days_not": len(df) - on})
    r = pd.DataFrame(rows)
    # Variation is needed on BOTH sides: a food eaten every single day is as
    # uninformative as one eaten twice, because nothing contrasts with it.
    r["usable"] = (r["days_eaten"] >= min_days) & (r["days_not"] >= min_days)
    return r.sort_values("days_eaten", ascending=False).reset_index(drop=True)


def naive_contrast(df, feature, target="sym_mean", lag=1):
    """Plain 'mean score the day after eating X vs not'. No adjustment at all."""
    x = df[feature].shift(lag)
    m = x.notna() & df[target].notna()
    on, off = df.loc[m & (x == 1), target], df.loc[m & (x == 0), target]
    if len(on) < 2 or len(off) < 2:
        return None
    sd = np.sqrt(((len(on)-1)*on.var() + (len(off)-1)*off.var()) / (len(on)+len(off)-2))
    return {"feature": feature, "lag": lag, "n_on": len(on), "n_off": len(off),
            "mean_on": on.mean(), "mean_off": off.mean(),
            "diff": on.mean() - off.mean(),
            "cohens_d": (on.mean() - off.mean()) / sd if sd > 0 else np.nan}
```

### The exposure threshold, and why

**Require at least 15 days with the food and 15 days without, out of ~200.**

The reasoning is a power calculation, not a convention. A two-group comparison
with 15 and 150 observations can detect roughly a 0.9-SD difference at 80% power.
On a 1–5 scale whose day-to-day SD is typically 0.8–1.0, that is about **a full
point of symptom score** — an effect so large you would probably have noticed it
without any statistics. Below 15 exposed days you are not measuring a small
effect badly; you are unable to measure it at all.

Foods that fail the threshold are not discarded. They are **rolled up**: a food
eaten 6 times contributes to its `dairy` tag and its `Snacks` category, and the
tag is what you test. This is the main reason the tag vocabulary is worth
maintaining — it turns 40 hopeless columns into a dozen testable ones. Read that
vocabulary from `food_tags` in the export rather than assuming it: it is a
catalog you own, and a tag you add next month becomes a column here for free.

### Dose, now that you have some of it

`portion` and, now, `tag_intensity` make dose-response expressible for the first
time, but only on the rows that carry them, and the question they answer is a
*different* question from the screen's. The screen asks whether a day following
the food is worse than a day following none of it. Dose asks whether, **among the
days you did eat it, more of it — or a stronger version of it — was worse**.
Keeping those separate is the whole discipline here: run them together and an
ordinary eaten-versus-not effect will present itself as a dose gradient.

Portion and intensity are two independent judgments about the same exposure, not
two measurements of the same thing. A large cup of weak tea and a small strong
coffee are different exposures, and a feature built from only one of them calls
them identical. `tag_dose` below multiplies the two rather than picking one:

```python
# features.py
PORTION_WEIGHT = {"small": 0.5, "medium": 1.0, "large": 2.0}
DEFAULT_INTENSITY = 2      # what the app treats an ungraded tag as
INTENSITY_WEIGHT = {1: 0.5, 2: 1.0, 3: 2.0}

def tag_dose(row, tag):
    """Exposure to one tag from one food, on an arbitrary but consistent scale.

    Two independent multipliers: how much of the food you ate (portion) and how
    much of the tag the food contains (intensity). Neither substitutes for the
    other — a large cup of weak tea and a small strong coffee are different
    exposures, and the binary tag alone calls them identical.
    """
    if not row[f"tag_{tag}"]:
        return 0.0
    portion = PORTION_WEIGHT.get(row["portion"], 1.0)
    grade = row.get(f"tag_{tag}_intensity")
    intensity = INTENSITY_WEIGHT[int(grade)] if pd.notna(grade) else INTENSITY_WEIGHT[DEFAULT_INTENSITY]
    return portion * intensity
```

One default worth naming: `PORTION_WEIGHT.get(row["portion"], 1.0)` falls back to
the medium multiplier for a food logged without a recorded size — a real
exception to the rule earlier in this guide against ever imputing "medium" for a
missing portion. It is deliberate here and nowhere else: `tag_dose` is meant to
always resolve to a number, so that the coverage check below has something to
measure for every graded exposure, not a report of the size itself. If you want
the stricter behaviour instead — dropping an unsized row rather than guessing —
return `np.nan` there when `pd.isna(row["portion"])`, before multiplying.

**Coverage first, always.** Before using a dose feature, print how many
exposures actually carry a grade. If most of the column is imputed at 2 then the
dose is the portion feature wearing a hat, and you should say so rather than
report it as dose:

```python
cons = d["cons"]
for tag in d["tag_ids"]:
    exposed = cons[cons[f"tag_{tag}"] == 1]
    graded = exposed[f"tag_{tag}_intensity"].notna().mean()
    print(f"{tag}: {len(exposed)} exposures, {graded:.0%} graded")
```

**Grading is not missing at random.** You grade the foods you eat often and
think about. Those are also the foods you have opinions about. An intensity
column filled in exactly where you already suspect a trigger will confirm that
suspicion whether or not it is true. This is the same selection argument the
guide already makes about when portions get recorded — say it outright here too,
because it is the more dangerous version of it.

**The weights are a choice, not a measurement.** 0.5 / 1 / 2 on both axes is a
doubling ladder picked for being defensible, not for being right. Any conclusion
that flips when the weights change to 1 / 2 / 3 is a conclusion about the
weights, not about the food. Re-run the headline result under a second weighting
before you trust it, and report both.

The per-food regression below still asks the narrower, portion-only version of
this question — does size alone predict severity for one specific food — which
stays useful even for a food that has never been graded on any tag:

```python
def dose_response(df, fid, target="sym_mean", hac_lags=7):
    """Large vs small, among days FOLLOWING a sized exposure.

    Every row here had the food, so the only thing varying is how much of it.
    Days it was eaten unsized are dropped rather than filled: an imputed
    "medium" is a guess entered as data, and on a three-level scale the guesses
    would outnumber the real levels and flatten any gradient toward zero.

    `dose` enters as a rank, which assumes small→medium and medium→large are the
    same step. They are not — the sizes are three taps, not grams — so read the
    slope as a direction, and the level means below it as the actual evidence.
    """
    import statsmodels.api as sm
    dose = df[f"dose_{fid}"].shift(1).rolling(3, min_periods=1).max()
    sub = pd.DataFrame({"dose": dose, "ar1": df[f"{target}__lag1"],
                        "y": df[target], "phase": df["phase"]}).dropna()
    if sub["dose"].nunique() < 2 or len(sub) < 20:
        return None
    X = pd.concat([sub[["dose", "ar1"]].astype(float),
                   pd.get_dummies(sub["phase"], prefix="ph", drop_first=True,
                                  dtype=float)], axis=1)
    res = sm.OLS(sub["y"].astype(float),
                 sm.add_constant(X, has_constant="add")).fit(
                     cov_type="HAC", cov_kwds={"maxlags": hac_lags})
    return {"food": fid, "n": len(sub),
            "n_by_level": sub.groupby("dose").size().to_dict(),
            "mean_by_level": sub.groupby("dose")["y"].mean().round(2).to_dict(),
            "beta_per_step": res.params["dose"], "p": res.pvalues["dose"]}
```

Run this only on suspects the screen already ranked, and read `n_by_level` before
anything else. If one level has four days in it there is no gradient to see, and
a `p` computed over it is noise with a decimal point. A dose result **cannot
promote a food onto the shortlist**; it can only make a food already on it more
or less credible. A suspect whose large portions look no worse than its small
ones is a weaker suspect, and a coherent small < medium < large ordering is the
one piece of purely observational evidence here that is genuinely hard to
manufacture by confounding — co-occurring foods explain why a day was bad, but
they have to explain the *ordering* too, and mostly they cannot.

Never build a column that mixes dose with absence. `df[f"dose_{fid}"].fillna(0)`
looks harmless and is not: it turns "eaten, unsized" and "not eaten" into the
same row, and since unsized rows are the majority it hands most of your exposed
days to the unexposed group.

---

## 3. Start with the boring thing

Do all of this before fitting anything.

```python
import pandas as pd
from load import load_export, build_daily
from features import add_lags, exposure_report, naive_contrast

d  = load_export("health_tracker_full_2026-08-29.json")
df = build_daily(d)

# 1. How much data is there really?
print(len(df), "days;", int(df["checked_in"].sum()), "check-ins;",
      int(df["any_food_logged"].sum()), "days with food logged")
print(df["phase"].value_counts())

# 2. Is missingness related to severity? If check-ins cluster on good days,
#    every estimate below is biased toward whatever you eat when you feel fine.
print(df.groupby(df["checked_in"])["n_food_events"].mean())
print(df["sym_mean"].describe())
print(df.groupby("phase")["sym_mean"].agg(["mean", "count"]))

# 3. The same question for portions. Sizes are recorded when you are paying
#    attention, and attention is not independent of how your skin feels — if
#    these two means differ, every dose result is computed on a selected sample.
sized_day = df["n_sized"] > 0
print("share of food events sized:", (df["n_sized"].sum() / df["n_food_events"].sum()).round(3))
print(df.groupby(sized_day)["sym_mean"].agg(["mean", "count"]))

# 4. Autocorrelation — the thing that makes naive analysis fail.
print("lag-1 autocorr:", df["sym_mean"].autocorr(1).round(3),
      " lag-2:", df["sym_mean"].autocorr(2).round(3))

# 5. Exposure counts.
rep = exposure_report(df, df.attrs["food_names"], min_days=15)
print(rep.to_string(index=False))
usable = rep.loc[rep["usable"], "feature"].tolist()

# 6. Same-day vs lag-1 vs lag-2, for everything usable.
df = add_lags(df, usable, max_lag=3)
nc = pd.DataFrame([r for f in usable for L in (0, 1, 2)
                   if (r := naive_contrast(df, f, lag=L))])
print(nc.reindex(nc["diff"].abs().sort_values(ascending=False).index).head(20)
        .to_string(index=False))
```

Read the lag table as a **shape**, not a ranking. A real food effect usually shows
a coherent profile — weak same-day, strongest at lag 1 or 2, fading by lag 3. A
number that spikes at exactly one lag and vanishes either side is far more likely
to be noise, and treating it as a discovery is the classic mistake here.

Plot the thing too. `df["sym_mean"].plot()` with the phases shaded will tell you
more in ten seconds than any coefficient, because it shows you the long
good-and-bad stretches that make everything downstream difficult.

---

## 4. Models, ranked

Run this one first.

### 1. Per-exposure adjusted lag regression with HAC errors + FDR — **the one to run**

For each candidate exposure separately: `score_t ~ ate_recently + score_{t-1} + phase`.
It directly handles the three things that actually threaten you — persistence,
phase confounding, and multiplicity — it is interpretable on the score's own
scale, and it degrades gracefully at n=200. Small separate models rather than one
joint fit, because with dozens of collinear foods on 200 days a joint OLS is not
identifiable. Its output is a **ranked shortlist**, which is exactly what you feed
into a Challenge.

Portion does not change this. The binary `ate_recently` term stays the headline,
because it is the only exposure defined on every logged day; dose is a follow-up
run on the survivors in §2, not a replacement for the screen.

```python
# screen.py
import numpy as np, pandas as pd, statsmodels.api as sm
from statsmodels.stats.multitest import multipletests

def screen_exposures(df, features, target="sym_mean", lag_col="__any1_3",
                     phase=True, hac_lags=7):
    ar_col = f"{target}__lag1"
    rows = []
    for f in features:
        col = f + lag_col
        if col not in df.columns: continue
        sub = df[[col, ar_col, target] + (["phase"] if phase else [])].dropna()
        if sub[col].nunique() < 2 or len(sub) < 30: continue
        X = pd.DataFrame({"exposure": sub[col].astype(float), "ar1": sub[ar_col]})
        if phase:
            # The elimination diet changes what you eat AND is started because
            # you feel bad. Without this term nearly every non-safe food inherits
            # the phase's severity and looks like a trigger.
            X = pd.concat([X, pd.get_dummies(sub["phase"], prefix="ph",
                                             drop_first=True, dtype=float)], axis=1)
        X = sm.add_constant(X, has_constant="add")
        # Newey-West: residuals of a daily series stay correlated even after the
        # AR term. Plain OLS errors are too small here and manufacture p-values.
        res = sm.OLS(sub[target].astype(float), X).fit(
            cov_type="HAC", cov_kwds={"maxlags": hac_lags})
        ci = res.conf_int()
        rows.append({"feature": f, "n": len(sub), "n_exposed": int((sub[col] > 0).sum()),
                     "beta": res.params["exposure"], "se": res.bse["exposure"],
                     "ci_lo": ci.loc["exposure", 0], "ci_hi": ci.loc["exposure", 1],
                     "p": res.pvalues["exposure"]})
    out = pd.DataFrame(rows)
    if out.empty: return out
    # Benjamini-Hochberg, not Bonferroni: this is a screen whose output is a
    # shortlist for a reintroduction test, so a controlled false-DISCOVERY rate is
    # the right currency. Bonferroni over 40 foods on 200 days finds nothing ever.
    out["q"] = multipletests(out["p"], method="fdr_bh")[1]
    return out.sort_values("q").reset_index(drop=True)
```

```python
res = screen_exposures(df, usable)
print(res.head(15).to_string(index=False))
```

`beta` is in symptom-score points. A beta of 0.3 means "days following this food
average a third of a point worse, holding yesterday's score and the phase fixed".

### 2. Elastic net over all exposures jointly

Worth running *second*, as a cross-check on the ranking rather than as the answer.
It handles p >> n, and elastic net rather than pure lasso because your predictors
are heavily correlated — milk, cheese and the `dairy` tag move together, and lasso
picks one of a correlated group arbitrarily and zeroes its twins, which reads as
"cheese matters, milk doesn't" when the data says no such thing.

Its real value is the **honest baseline** it gives you:

```python
# enet.py
import numpy as np, pandas as pd
from sklearn.linear_model import ElasticNet
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import TimeSeriesSplit, GridSearchCV
from sklearn.metrics import mean_absolute_error

def elastic_net_select(df, features, target="sym_mean", lag_col="__any1_3", seed=0):
    cols = [f + lag_col for f in features if f + lag_col in df.columns]
    sub = df[cols + [f"{target}__lag1", target]].dropna()
    X, y = sub[cols + [f"{target}__lag1"]], sub[target].astype(float)
    grid = GridSearchCV(
        make_pipeline(StandardScaler(), ElasticNet(max_iter=50_000, random_state=seed)),
        {"elasticnet__alpha": np.logspace(-3, 0.5, 25),
         "elasticnet__l1_ratio": [0.1, 0.3, 0.5, 0.7, 0.9]},
        # TimeSeriesSplit, never KFold — see §5.
        cv=TimeSeriesSplit(n_splits=5), scoring="neg_mean_absolute_error")
    grid.fit(X, y)
    coef = pd.Series(grid.best_estimator_["elasticnet"].coef_,
                     index=X.columns).sort_values(key=abs, ascending=False)
    return grid, coef[coef != 0]

def baseline_comparison(df, features, target="sym_mean", lag_col="__any1_3"):
    """Does food add anything over 'tomorrow looks like today'?"""
    cols = [f + lag_col for f in features if f + lag_col in df.columns]
    sub = df[cols + [f"{target}__lag1", target]].dropna()
    y, X = sub[target].astype(float), sub[cols + [f"{target}__lag1"]]
    persist, full = [], []
    for tr, te in TimeSeriesSplit(n_splits=5).split(sub):
        persist.append(mean_absolute_error(y.iloc[te], sub[f"{target}__lag1"].iloc[te]))
        m = make_pipeline(StandardScaler(),
                          ElasticNet(alpha=0.05, l1_ratio=0.5, max_iter=50_000)).fit(X.iloc[tr], y.iloc[tr])
        full.append(mean_absolute_error(y.iloc[te], m.predict(X.iloc[te])))
    return {"mae_persistence": np.mean(persist), "mae_with_food": np.mean(full)}
```

Do not feed `dose_*` columns into this. They are NaN on most rows, and `.dropna()`
across a wide matrix of them will silently cut the fit down to the handful of days
where every food happened to be sized.

On a simulated 210-day dataset with a **real, large, planted** dairy effect, this
returned `mae_persistence 0.55` against `mae_with_food 0.63` — the food model was
*worse* out of sample than simply predicting today's score from yesterday's.

That is the normal result, and it is not a bug. It tells you that **predictive
skill is the wrong yardstick** for this question. Food effects are small relative
to day-to-day noise and persistence; you are trying to estimate one coefficient
honestly, not forecast tomorrow. Do not abandon a real finding because the model
does not predict well, and do not trust a model *because* it predicts well.

### 3. GEE with an AR(1) working correlation

`statsmodels.genmod.GEE` with `cov_struct=Autoregressive()` is a defensible
alternative to #1 and models the autocorrelation explicitly rather than patching
the standard errors. In practice it gives you very similar answers for more
setup. **Mixed-effects models are not useful here**: with one subject there is no
grouping factor to put a random effect on. If you see a tutorial fitting a random
intercept per person, it does not apply to n-of-1 data.

### 4. Gradient boosting + SHAP

Do not use this to identify triggers. With ~200 rows and 40 correlated columns,
boosting will fit the good-and-bad stretches almost perfectly and SHAP will
confidently attribute them to whichever foods happened to co-occur — a very
persuasive picture of nothing. If you run it anyway: heavy regularisation
(`max_depth=2`, `n_estimators<100`, high `min_child_weight`), blocked time-series
CV only, and treat any SHAP result not already visible in §3 as an artefact. Its
one legitimate use is **hypothesis generation for interactions** ("dairy only
matters on bad-sleep days"), which you then test properly.

### 5. Bayesian (`bambi` / `pymc`)

Genuinely useful, but **as step two, not step one**. Once §1 has given you three
suspects, refit just those with weakly informative priors and report the
posterior. It gives you the thing you actually want — "an 80% chance the effect is
between 0.1 and 0.6 points" — instead of a point estimate and a p-value, and the
priors shrink implausibly large estimates that small samples throw up. Fitting 40
foods in a Bayesian framework does not solve multiplicity for free; it just moves
it. This is also the sanest home for the dose model, where the three levels have
too few days each to support anything else.

---

## 5. Validating honestly

**Never use random k-fold.** Random folds put tomorrow in training and yesterday
in test. With a series this autocorrelated, the model can half-memorise the test
fold from its neighbours and report skill it does not have. Use
`TimeSeriesSplit`, which always trains on the past and tests on the future.

**Permutation with block structure.** Shuffling days independently destroys the
autocorrelation that creates spurious associations in the first place, so it
clears almost anything. Circularly *shift* the exposure series instead: each
series keeps its own structure, only their alignment breaks.

```python
def permutation_null(df, feature, target="sym_mean", lag_col="__any1_3",
                     n=2000, block=14, seed=0):
    import statsmodels.api as sm
    rng = np.random.default_rng(seed)
    col = feature + lag_col
    sub = df[[col, f"{target}__lag1", target, "phase"]].dropna()
    if len(sub) < 30: return None
    ph = pd.get_dummies(sub["phase"], prefix="ph", drop_first=True, dtype=float)

    def beta(expo):
        X = pd.concat([pd.DataFrame({"exposure": np.asarray(expo, float),
                                     "ar1": sub[f"{target}__lag1"].values},
                                    index=sub.index), ph], axis=1)
        return sm.OLS(sub[target].astype(float),
                      sm.add_constant(X, has_constant="add")).fit().params["exposure"]

    obs, v = beta(sub[col].values), sub[col].values
    null = np.array([beta(np.roll(v, rng.integers(block, len(v) - block))) for _ in range(n)])
    return {"feature": feature, "observed_beta": obs, "null_sd": null.std(),
            "p_perm": float((np.abs(null) >= abs(obs)).mean())}
```

Also run it on a **negative control** — a food you have no reason to suspect, like
rice. If your pipeline flags rice, the pipeline is broken, not your diet.

**What an effect has to look like before you act on it.** All four, not any one:

- `beta` ≥ **0.3 score points** (roughly a third of a day-to-day SD). Anything
  smaller is not something you could feel, and is not worth restricting a food for.
- The **confidence interval excludes zero** and is not absurdly wide.
- **q < 0.10** after Benjamini-Hochberg, and `p_perm` agreeing.
- A **coherent lag profile** (§3) rather than a single spike.

A dose gradient is a fifth thing worth looking at, but it is not a fifth
requirement — most of your suspects will not have enough sized exposures for the
question to be askable at all, and a food is not exonerated by silence.

### Expect to find nothing significant, and understand why

On the simulated 210-day dataset above — where dairy was planted with a large,
genuine lag-1 effect — the screen ranked dairy **first**, with `beta 0.67,
95% CI [0.19, 1.14], p 0.006`, and the block permutation gave `p_perm 0.000`.

But **nothing survived FDR correction**: the best q-value was 0.118.

Sit with that. A real, large, deliberately planted effect, on 191 check-ins, with
a correctly specified model, did not clear a false-discovery threshold. That is
the honest power of this dataset. It is precisely why the output of this analysis
is a **ranked shortlist for a Challenge**, and not a verdict.

In the same run, the largest raw contrast belonged to `high_fat` (d = 1.39),
not dairy — because the dairy foods were *also* high-fat. The unadjusted number
pointed at the wrong culprit. That is confounding by co-occurrence, and it is the
normal condition of food data, not an edge case.

---

## 6. The part that actually identifies a trigger

Observational logs cannot confirm a trigger. You never randomised what you ate;
you chose it, for reasons that were often themselves connected to how your skin
felt. Every estimate above is an association standing in a queue of alternative
explanations.

**A reintroduction test is the only thing that breaks that queue**, and the app
already has the machinery: `startChallenge` in `lib/phases.ts` writes a
`challenge` span carrying `what` — free text naming the food you are
reintroducing — and that span is in the export.

The loop:

1. **Screen** (§4) → rank suspects by adjusted beta.
2. **Take the top one.** One at a time — two at once and you cannot attribute
   the result.
3. **Establish a clean baseline.** An elimination, or a settled no-phase stretch,
   until the score is stable and low for 7–10 days. Without a stable baseline
   there is nothing for the challenge to move.
4. **Start a Challenge**, naming the food in the label, and reintroduce that food
   alone, deliberately, at a realistic dose, for 3+ consecutive days.
5. **Record the portion every time.** This is the one window where sizes are
   worth the taps: inside a challenge you are paying attention by definition, so
   the usual selection problem (§7) is at its weakest and a dose reading is at
   its most trustworthy.
6. **Watch 5–7 days past the last exposure**, because the reaction is lagged.
7. **Withdraw and watch it settle.** A trigger should show a rise on
   reintroduction *and* a fall on withdrawal. One direction alone is a coincidence
   waiting to happen.
8. **Repeat the challenge once** if the result was positive. A single
   reintroduction that goes badly during a stressful week is not a finding.
9. **Feed it back:** confirmed triggers leave the suspect list, and you re-screen
   for the next one.

Analysis of the challenge itself is a before/during/after contrast on a handful of
days, and it is deliberately simple — you look at the scores. The rigour came from
controlling the exposure, not from the statistics.

Because the ledger holds spans rather than a per-day map, a challenge is already a
labelled window and you do not have to reconstruct episodes from per-event flags:

```python
# Every challenge ever run, as a window with the food it was testing.
def challenge_windows(d):
    from load import span_last_day
    return [{"what": s["what"],
             "start": pd.Timestamp(s["startDate"]),
             "end":   pd.Timestamp(span_last_day(s, d["today"]))}
            for s in d["ledger"]["spans"] if s["kind"] == "challenge"]

for w in challenge_windows(d):
    # Symmetric 10 days either side: the before is the baseline the challenge is
    # supposed to move, and the after is where a lagged reaction actually lands.
    win = df.loc[w["start"] - pd.Timedelta(days=10) : w["end"] + pd.Timedelta(days=10)]
    # include_lowest, or the window's first day falls out of every bin: cut's
    # intervals are left-open and it would silently drop a baseline day.
    when = pd.cut(win.index, [win.index[0], w["start"] - pd.Timedelta(days=1),
                              w["end"], win.index[-1]],
                  labels=["before", "during", "after"], include_lowest=True)
    print(w["what"], w["start"].date(), "→", w["end"].date())
    print(win.groupby(when, observed=True)["sym_mean"].agg(["mean", "count"]).round(2))
```

**There is no per-log challenge flag, and you do not want one.** Consumption
logs used to carry `is_challenge`, but nothing in the app ever set it — every
log ever written had it `false`, so any analysis keying off it found zero
exposures and silently reported nothing. It has been removed. An export taken
before that still has the field; ignore it there too, for the same reason.

The challenge span's dates and its `what` are the real record, and they are
better: the span says what you were reintroducing, which a boolean never did.

`is_accident` *is* wired up and is worth carrying — an accidental exposure
during an elimination is a natural experiment you did not plan.

---

## 7. What this data cannot tell you

**Confounding is everywhere.** The elimination phase changes what you eat *and*
is undertaken when you feel bad. Foods co-occur — milk with cereal, chilli with
fried food — so their columns are near-duplicates and the model cannot tell them
apart on 200 days. Weather, stress, sleep, detergent, and pollen move your skin
and are mostly not in this dataset at all. A food that tracks your symptoms may
simply be the food you eat on the days that also do something else to you.

**Reverse causality is real and runs the wrong way.** Feeling bad changes what
you eat — comfort food during a flare, or strictness after one. A food that
appears *before* a bad stretch may have been *caused* by the start of it. The
lagged design reduces this but cannot eliminate it, because flares build over
days and you respond to them before you score them.

**Missingness is not random, and it is the worst problem here.** You skip
check-ins on bad days and on busy days. If bad days are systematically missing,
every "mean score after eating X" is computed on a filtered, rosier sample, and
the filter may correlate with the exposure. Nothing in the analysis fixes this;
`checked_in` and `days_since_checkin` only let you *detect* it. Check whether
check-in gaps cluster after particular foods — if they do, treat that food's
estimate as unusable rather than reassuring.

**Recorded portions are the same problem in miniature.** You now have a dose, but
only where you tapped a size, and you tap a size when you are paying attention —
which means during a challenge, on a food you already suspect, and on the day
after a bad one. That is missing-not-at-random by construction. The consequence
is specific: your sized exposures are enriched for the days you were watching,
and if watching correlates with severity then the dose gradient is measuring
attention as much as quantity. The §3 diagnostic exists to show you how bad this
is. Nothing corrects it, and no imputation helps — a filled "medium" does not
recover the missing information, it just stops you seeing that it is missing.
Read a dose result as corroboration of a suspect, never as its own discovery.

**The daily grid throws away time of day.** The timestamps are all there, but
aggregating to a day makes a 7am breakfast and an 11pm snack the same row, and a
late-evening exposure has a different amount of the night to act in than a
morning one. That is a modelling choice you could revisit, not a hole in the
data — but at n≈200 days, splitting each exposure into morning and evening halves
the counts and there is no power left to spend.

**The scale is ordinal, not metric.** The distance from 2 to 3 is not necessarily
the distance from 4 to 5. Treating scores as continuous is a workable
simplification, not a fact, and it makes `sym_mean` — an average across
differently-behaved symptoms — the softest number in the whole pipeline. Run your
top candidates against individual symptoms too; a trigger that only moves
`sym_mean` and no single symptom is probably an artefact of averaging. The same
caution applies to the portion rank, which is three taps rather than a
measurement.

**And the size of the thing.** ~200 days is one person, one set of habits, one
year's weather. A correlation over that is a **hypothesis worth testing**, not a
finding, and certainly not a diagnosis. Foods matter far less to eczema than most
people expect; the honest outcome of this analysis is frequently "nothing here is
distinguishable from noise", and a restrictive diet adopted on a q-value of 0.11
costs you real quality of life for a result the data does not support.

Take the shortlist to a dermatologist or allergist alongside the export. Patch
testing and supervised food challenges answer questions this dataset structurally
cannot.
