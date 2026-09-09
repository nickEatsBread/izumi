# Existing recommendation system: follow-up evaluation

Evaluated 8 September 2026. The tables below preserve the audit of the implementation before
product changes. The accepted corrections are now implemented locally; see the
[implementation and validation notes](fixes.md). This supplements the
[initial research](../recommendation-watch-habits-research.md).

**Audit verdict: izumi has a working, explainable recommendation baseline, but its handling
of preference and recovered viewing data had reproducible weaknesses. Correct those first.
Neither a new recommendation service nor additional watch telemetry is needed to fix the
rating, timestamp, season identity, alias and seed-budget problems demonstrated here.**

Real-world recommendation relevance remains unmeasured. This evaluation does not claim a
percentage accuracy, a user failure rate, or superiority/inferiority to another product.

## Method and results

| Check | Result | What it establishes |
| --- | --- | --- |
| Existing full-client/Worker suites | 101 tests passed across 16 files | Current ranking, candidate loading, history, incognito, feedback, profile, account and sync contracts covered by those fixtures still pass |
| Existing authoritative Companion suites | 19 tests passed across 3 files | Existing checkpoint, discovery and profile fixtures still pass |
| New behavioral evaluation | 9 controls passed; 10 evaluation criteria failed | Concrete counterexamples in the current implementation, described below |
| Local engine benchmark | 3 synthetic workload sizes measured | Approximate local cost and scaling; no claim about deployed Worker CPU |

The new evaluation imports the **actual exported production functions**. It exercises
history snapshots, signal building, final ranking, Companion deck generation and checkpoint
application. It does not duplicate their algorithms or extract selected function bodies.
The original audit mocked external candidate retrieval and cloud checkpoint delivery. Test stores are
in memory; all titles are synthetic. Checkpoint tests reject unexpected network activity.

The criteria are explicit engineering expectations, not inferred labels from real users.
They deliberately include suspected edge cases, so **10/19 must never be reported as an
estimated defect rate or recommendation accuracy**. The original failing report is preserved.
The accepted cases now run in normal CI, with additional regression coverage. E1 now also
accepts absence of a seed (zero evidence); E9/E10 mock the catalog detail adapter introduced
by the fix and assert real resume lookups against its native episode table.

Artifacts: [recommendation regressions](../../src/lib/recommendations/watch-habits-regressions.test.ts),
[checkpoint regressions](../../src/lib/companion/checkpoint-regressions.test.ts),
[raw evaluation results](results.json), [existing main-client test results](existing-tests.json),
[benchmark implementation](benchmark.mjs), [benchmark results](benchmark-results.json).

## What works

The nine new controls verify that:

- Positive genre evidence changes ordering appropriately for controlled equal-quality candidates.
- The same inputs and time produce the same ranking.
- Explicit Discover dismissals reduce matching affinity and exclude the selected title.
- Skip is neutral taste, hides the title temporarily, and expires after seven days.
- Known external identities deduplicate candidates and carry exclusions through the full signal set.
- Incognito playback updates its temporary overlay without creating durable recommendation seeds.
- A completed known-length series contributes more than one confirmed episode of that series.
- Companion metadata caching still allows fresh explicit feedback to change ranking when the
  main-client deck generator runs. The cache does not freeze taste for 15 minutes.
- Checkpoints for another profile are rejected and repeated delivery of the same cloud
  checkpoint is ignored.

Several bullets share one control test. These checks support retaining the current engine
and encrypted transport rather than treating the existing system as a failed foundation.

## Confirmed counterexamples and their importance

| Criterion | Actual result | Assessment |
| --- | --- | --- |
| E1: uncompleted opening carries less evidence than completion | Opening episode 3 with unknown episode count and zero progress has weight 1.0; a completed 12-episode series also has weight 1.0 | Signal interpretation defect; prioritize before tuning weights |
| E2: a completed 2/10 rating does not positively promote related titles | With list membership retained, the related genre ranks above an unrelated equal-quality candidate | Preference interpretation defect; rating arithmetic is affecting actual ranking |
| E3: later negative rating survives an older save | The negative rating alone ranks the unrelated candidate first; adding yesterday's save reverses the result | Precedence defect; latest explicit evaluation loses to save priority |
| E4: known contributor taste survives history persistence | The full metadata seed yields a contributor match; passing through `mediaSnapshot` turns the same candidate into an exploration pick | Confirmed capability gap caused by compact storage; solve with enrichment or a separate feature cache, not necessarily larger resume records |
| E5: TV retains viewing evidence with 100 saved library titles | Full-client ranking recognizes the history match; `companionDiscovery` labels it exploration | Confirmed TV/main-client inconsistency caused by priority-first truncation |
| E6: a poor rating does not positively seed the older anime row | A completed 2/10 title still produces a positively scored related recommendation | Confirmed legacy policy gap; the older row is not using Discover's negative-affinity model |
| E7: richer matching metadata survives cross-catalog deduplication | Rich-first ordering recognizes the contributor connection; sparse-first ordering loses it | Confirmed metadata/order sensitivity; duplicates collapse but their features are not merged |
| E8: watched exclusions survive TV seed truncation | A verified alternate catalog identity of the watched title is returned after its history seed falls outside the budget | Exclusion defect; known-title filtering must not depend on retaining a taste seed |
| E9: delayed TV recovery preserves viewing time | A checkpoint 30 days old is stored in durable history with today's timestamp | Data semantics defect; changes recency and can reorder history/recommendations |
| E10: season-relative episode coordinates remain distinct | Season 1 episode 1 at 300 seconds and season 2 episode 1 at 600 seconds become one saved position, 600 seconds | Data-loss defect in the tested checkpoint path; highest priority because it also affects resume |

These are not ten independent root causes: E5/E8 share the seed-budget problem; E2/E3/E6
belong to preference handling. E10 is tested for season-relative checkpoint input. It does
not establish that every playback path supplies episode coordinates that way, nor that all
users have encountered it. E9/E10 were reproduced through `syncCompanionProgress` using
valid synthetic delivered records, rather than merely inferred from reading private helpers.

Code entry points: [Discover signals](../../src/lib/recommendations/discovery-queue.ts),
[shared ranking](../../src/lib/shared/recommendation-engine.ts),
[older row](../../src/lib/recommendations/for-you.ts),
[history](../../src/lib/player/history.ts), [positions](../../src/lib/player/progress.ts),
[TV deck](../../src/lib/companion/discovery.ts),
[checkpoint application](../../src/lib/companion/client.ts).

## What the web comparison does and does not support

**Completion thresholds are a normal watched-state policy.** Plex documents a configurable
percentage threshold, defaulting to 90%, with optional credits-marker handling. Therefore
izumi's 85% rule is not, by itself, a recommendation defect. A watched flag is still not a
precise record of unique consumed footage or satisfaction. The appropriate fix is to preserve
that distinction; there is no evidence here that moving izumi to 90% improves recommendations.
[Plex library settings](https://support.plex.tv/articles/200289526-library/).

**More viewing data can help, but exact industry weights are not public.** Netflix describes
history, ratings, similar viewers, metadata, recency and time spent. This supports considering
multiple evidence types, not copying a purported Netflix formula or claiming izumi can learn
from similar users without a suitable dataset. [Netflix documentation](https://help.netflix.com/en/node/100639).

**Clicks and duration are not a complete satisfaction measure.** YouTube's published account
describes the move beyond clicks to watch time and then satisfaction feedback. Its 2016 paper
describes separate candidate retrieval and ranking. These are useful principles, not a
validation of the earlier proposed 300-second threshold or 10–20% exploration allocation.
[YouTube explanation](https://blog.youtube/inside-youtube/on-youtubes-recommendation-system/),
[2016 research](https://research.google/pubs/deep-neural-networks-for-youtube-recommendations/).

**A small hand-picked catalog cannot establish ranking accuracy.** Research on sampled
recommendation metrics shows that sampled rankings can even reverse comparisons between
recommenders. This audit's small fixtures test concrete behavior only. A later relevance
benchmark needs a defined eligible catalog, time-split histories, candidate-retrieval recall
and ranking metrics, without treating unknown titles as proven dislikes.
[Krichene and Rendle, 2020](https://research.google/pubs/on-sampled-metrics-for-item-recommendation/).

The previous Stremio and Nuvio comparison remains a schema/API comparison. We have not
verified a proprietary recommendation algorithm or benchmarked personal accounts in either
client. Plex's documentation was available as indexed first-party search excerpts; direct
requests returned 403 during this follow-up. Do not imply authenticated product testing.

## Cost of the current ranker

Node v22.16.0, Windows x64, two warm-up calls then nine measured calls for each workload,
60 returned recommendations, fixed synthetic metadata and clock:

| Candidates | Seeds | Median elapsed time | Observed min–max |
| ---: | ---: | ---: | ---: |
| 100 | 25 | 12.75 ms | 9.94–20.22 ms |
| 300 | 100 | 51.31 ms | 47.21–53.38 ms |
| 1,000 | 300 | 269.77 ms | 228.82–305.53 ms |

These are local synchronous elapsed times under the machine's current load, not an SLO,
production latency percentiles, cold-start measurements, or Cloudflare CPU readings.
Different metadata density changes cost. The benchmark saves the engine SHA-256 so it can
be tied to the evaluated implementation.

Cloudflare documents a 10 ms free-plan HTTP CPU budget. The results warrant optimization
and an actual target-runtime benchmark before promising independent Worker ranking on the
free tier. They do not prove the Worker will exceed its limit.
[Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/).

## What should happen before a larger redesign

1. Correct season identity and event time in checkpoint recovery; retain existing deduplication
   and profile checks. Those defects matter even without changing recommendations.
2. Define one preference hierarchy: direct post-viewing ratings/dislikes above earlier saves;
   an uncompleted opening must not equal completion. Keep explicit rules for intentional
   contradictory actions and use their timestamps.
3. Separate exclusion identities from the bounded taste seed list. Reserve TV seed capacity
   for observed viewing, and merge or enrich duplicate metadata without order-dependent loss.
4. Use these audit fixtures as acceptance tests for each fix; after a fix, its criterion should
   pass and the relevant existing suite should still pass. Convert accepted regression cases
   into normal CI tests as part of that implementation.
5. Then evaluate richer consumption measurements, candidate retrieval and independent Worker
   ranking separately. There is no need to deploy all three to test whether the corrected
   baseline is already useful.

Remaining unanswered questions require different evidence: actual metadata coverage across
enabled catalogs; candidate recall for real profiles; whether people like/save/finish the
recommendations; performance in the deployed Worker; and physical-TV recovery behavior.
No live user history, account access, deployed Worker or physical TV was used for this audit.

## Reproduce

Run from the full-client repository root. Current regressions should pass. Preserve the original
`results.json`, `existing-tests.json` and `benchmark-results.json` when recording new runs.
The JSON reporter writes absolute file paths and stack traces; strip the machine-specific prefix
from any new output before committing it.

```powershell
.\node_modules\.bin\vitest.cmd run --config docs/recommendation-evaluation/vitest.config.ts --reporter=json --outputFile docs/recommendation-evaluation/fixed-results.json
node docs/recommendation-evaluation/benchmark.mjs
```

Original existing-suite selection (use a new output file when rerunning it):

```powershell
.\node_modules\.bin\vitest.cmd run src/lib/shared/recommendation-engine.test.ts src/lib/recommendations/discovery-queue.test.ts src/lib/recommendations/for-you.test.ts src/lib/recommendations/candidates.test.ts src/lib/recommendations/feedback-sync.test.ts src/lib/player/history-provider.test.ts src/lib/player/history-io.test.ts src/lib/player/progress.test.ts src/lib/player/incognito.test.ts src/lib/sync/cloudflare-companion-sync.test.ts src/lib/sync/cloudflare-discovery-worker.test.ts src/lib/companion/profile-recovery-guard.test.ts src/lib/companion/snapshot.test.ts cloudflare-sync-worker/tests/accounts.test.ts cloudflare-sync-worker/tests/accounts-routes.test.ts cloudflare-sync-worker/tests/cloudflare-profiles-worker.test.ts --maxWorkers 2 --reporter=json --outputFile docs/recommendation-evaluation/rerun-existing-tests.json
```

Run the following in the separate authoritative Companion repository:

```powershell
.\node_modules\.bin\vitest.cmd run src/lib/discovery.test.ts src/lib/playback-progress.test.ts src/lib/profiles.test.ts --exclude 'izucomp/**' --exclude 'installer/**' --exclude 'updater/**' --exclude 'mobile/**' --exclude '.codex-tmp/**' --maxWorkers 2
```

The original follow-up was read-only apart from documentation, tests and reports. The subsequent
authorized implementation is described in [fixes.md](fixes.md); it has not been deployed.
