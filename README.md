# Job market skills dashboard

The dashboard at <https://statistics.jobs.explosion.fun> shows the number of retained open and closed collector postings
that mention each keyword. Filters use publication dates supplied by job boards. Each keyword counts once per posting even when it appears repeatedly.
Counts are estimates based on literal matches in recognized role, responsibility and qualification sections. Boilerplate is excluded where recognized; postings without recognized sections contribute to the overall posting count but not keyword matches. Section categories are heuristic and mentions are not necessarily requirements. The collector's boards are not the whole job market.

Résumé PDF, DOCX and pasted text are parsed and matched in the browser. Files, extracted text, and
selected skills are not sent to the dashboard's backend. The public snapshot contains only aggregated
counts grouped by publication date, status, role and country; it includes no company names, job records, or applicant telemetry.
Industry is currently unknown because the collector has no industry classification.

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
range is applied. The line chart compares up to three skills by publication month, and the table
provides exact counts. These are publication cohorts of the records currently retained by the
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
