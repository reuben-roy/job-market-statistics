# Job market skills dashboard

The dashboard at <https://statistics.jobs.explosion.fun> shows the number of retained open and closed collector postings
that mention each keyword. Filters use publication dates supplied by job boards. Each keyword counts once per posting even when it appears repeatedly.
Counts are estimates based on literal matches in recognized role, responsibility and qualification sections. Boilerplate is excluded where recognized; postings without recognized sections contribute to the overall posting count but not keyword matches. Section categories are heuristic and mentions are not necessarily requirements. The collector's boards are not the whole job market.

Résumé PDF, DOCX and pasted text are parsed and matched in the browser. Files, extracted text, and
selected skills are not sent to the dashboard's backend. The public snapshot contains only aggregated
counts grouped by publication date, status, role and country; it includes no company names, job records, or applicant telemetry.
Industry is currently unknown because the collector has no industry classification, so the site has
no industry filter.

## Daily refresh

The collector host has a crontab entry that runs `refresh_snapshot.py` at 03:15 in its configured
`America/Phoenix` timezone (03:15 Pacific during daylight saving time and 02:15 Pacific in winter).
It checks the collector's health and publication backlog, reads a consistent collector snapshot
under the collector's existing file lock, and sends only aggregated counts to an authenticated
Cloudflare Worker. The Worker validates the aggregate shape and stores the newest snapshot in KV.
The site labels snapshots older than 36 hours as possibly stale. Failed or unhealthy refreshes keep
the last snapshot; the host log is `~/.config/job-statistics/refresh.log`. There is not yet a separate
alert for a failed or missed refresh.

The versioned vocabulary is a curated list, not an automatic discovery system. More than 100 terms
are included; the daily job automatically updates their counts as jobs change. New vocabulary terms
must currently be reviewed and added manually. A first automatic candidate experiment produced too
much boilerplate to present as skills. To update vocabulary, update both this directory and the API
copy, bump its version, recompute a `public/fallback-snapshot.json`, deploy the site with the Worker
secret, then install the new vocabulary on the collector host and run its publisher. The browser
rejects snapshots from incompatible vocabulary versions and falls back to the bundled snapshot.

The Worker refresh token is stored as a Cloudflare secret and in a restricted file on the collector
host; do not commit or print it. Future `cf deploy` operations must preserve that secret. The local
API implementation is separate and is not currently deployed; the public website uses the Worker/KV
snapshot path.

## Verification

```sh
npm ci
npm test
python3 -m unittest discover -s scripts -p 'test_*.py'
cf deploy --dry-run
```

On October 27, the public endpoint showed 8,856 open postings and the host publisher completed a
manual run. The cron entry was installed but has not yet been observed running at its scheduled time.
The API's full test suite passed locally against disposable PostgreSQL containers. Production backup
coverage remains incomplete: Coolify has no configured backup destination or scheduled backup for the
API database, and WAL archiving is disabled. A same-host isolated logical restore succeeded; that is
not an off-host backup or point-in-time recovery.

## Historical comparisons

Date filters are inclusive and exclude postings without a valid source publication date when a date
range is applied. The line chart compares up to three skills by publication month, defaulting to the last twelve
months of share, and the table provides exact counts. Share months with fewer than 20 postings with
recognized sections are left blank. These are publication cohorts of the records currently retained by the
collector, not a reconstruction of how many jobs were open in prior months. Closed postings retained
by the collector are included, but jobs that closed before it began collecting are not available.
As of the first historical snapshot, the collector retained 8,856 open records and no closed records;
their supplied publication dates range from 2019 through October 2026. The daily job now includes
retained closed records as they accumulate.

## Compensation

The dashboard reports the mean of posted annual USD salary range midpoints, weighted by postings,
with the number of ranges included. Ranges are taken from the collector's existing salary fields;
other currencies and postings without usable ranges are excluded. The collector may combine
location-specific tiers in one range and its text extraction is imperfect. Role comparisons use
heuristic title categories. Monthly values are publication cohorts, not actual pay or a complete
historical survey; filters affect compensation as well as keywords. No skill-combination or causal
salary analysis is performed.

The section-aware exporter reprocesses all retained postings on every refresh using one set of rules.
Headings and candidate-facing boilerplate vary by employer; the recognized-section count and
section-specific filters expose coverage but do not prove correctness. Vocabulary remains curated.

## Statistics-only sources

The daily refresh also collects a small pilot set of public Lever boards into a separate
`statistics-only.sqlite3` journal on the collector host. These records are aggregated directly into
the dashboard snapshot and never enter the Job Applicator feed's publishing outbox. Lever board
failures or suspect empty/collapsed results retain the source’s prior records while other sources refresh;
a posting closes after it is absent from two successful complete polls. The list of boards is in
`scripts/collect_lever.py` and is intentionally small pending quality and operational validation.
The Lever API's `createdAt` is not necessarily a publication date, so these records have unknown
publication dates and are excluded when date filters are applied or monthly charts are drawn.
Exact source identities are deduplicated before aggregation. Daily global board-coverage history is recorded from October 30, 2026; it cannot reconstruct earlier coverage. Matching equivalent jobs advertised under different identities remains approximate/unimplemented.

## Fortune 500 expansion

`reports/fortune500/` contains the earlier 2026 discovery inventory and current Workday candidate
probes. A probed total is not a verified, unique posting count. The Workday collector runs
independently of the app feed and stores descriptions in `workday-statistics.sqlite3`; its aggregate
output joins the dashboard refresh when that database exists. It partitions larger boards when counts can be reconciled. If completeness cannot be established, capped subsets are explicitly partial and cannot close missing records. A board with missing listing paths can add
valid postings but cannot close missing ones and is marked partially fresh. Source health determines
the dashboard's conservative freshness label. Publication dates are unknown for these sources and
are excluded from publication-month trends and date filters. A cycle takes hours because descriptions
are fetched individually. Exact requisition identity prevents duplicate counts within a tenant, and daily aggregate coverage history is published without employer names; skill share is available to help compare differently sized cohorts, but does not
correct selection bias.

SmartRecruiters collection runs independently with five verified employer boards. It extracts the
API's job-description and qualifications fields and uses the releasedDate for publication cohorts.
All statistics-only records stay out of Job Applicator's outbox. Workday and SmartRecruiters details
are cached for up to seven days, with listing-signature changes forcing a refresh. First backfills
run asynchronously; configured or advertised totals are never treated as already collected data.

## Scheduled operations

On the collector host, Workday polls daily at 20:30 and SmartRecruiters at 19:00,
using the host’s America/Phoenix timezone. The existing aggregate publisher runs at 03:15.
Fortune 500 discovery runs weekly with checkpointed company-level results; discovered candidates
require API and ownership validation before activation. It has substantial false negatives, so an
unresolved company remains an investigation item. All 500 domains are in the input; this is not a
claim that all 500 career sites are currently collected. Logs live under ~/.config/job-statistics/.

Snapshot publication also runs hourly at minute 45, reading already collected records with
`STATS_SKIP_COLLECTION=1`. This does not re-poll job boards. A global refresh lock prevents
overlapping publication runs; the daily 03:15 job continues to refresh Lever collection.

## Private skill-demand explorer

Schema 4 snapshots carry exact counts of skill-set signatures per existing filter bucket. Each
signature encodes required, preferred and responsibility skill sets separately, using the versioned
vocabulary order. No posting text, employer names or résumés are exported. The Worker validates
signature counts against individual skill counts and posting totals. Schema 3 remains readable,
but joint counts and recommendations are explicitly unavailable for those older snapshots.

The résumé explorer computes match scores, single-skill demand, exact combinations, common
pairs/triples and suggested additions entirely in the browser. All market filters apply, including
the selected job section, and the role filter starts on the classified role with the most postings
sharing two or more of the résumé's skills. Demand percentages use all filtered postings; empty
skill extractions never count as complete coverage.

A posting is scored when it lists at least three tracked skills, excluding the general traits in
`skills.mjs`; its match is the share of those skills on the résumé, and 60% or more is a strong match.
Suggestions rank by how many postings would cross that line if the skill were added, require a
selectable minimum overlap with existing skills, and stay within the technical or business fields
the résumé already touches; data and delivery skills are open to both.
Counts describe this retained sample and do not assess proficiency, eligibility or causal benefit
from training. The bundle list is bounded to the twelve most-mentioned selected skills.

`skills.mjs` also holds résumé-only shorthand (REST, NLP, ETL) and implied skills (PostgreSQL implies
SQL). These affect only what the browser detects in a résumé. They are not vocabulary changes and do
not need a version bump, because the collected counts still use the literal vocabulary.
