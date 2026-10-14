# Domain context

## CNV analysis test scenario

A **CNV analysis test scenario** is a declarative description of samples, replicate
wells, target/reference Ct values, reaction panels, metadata, and analysis settings.
The test support module compiles that description into QuantStudio-like measurement
records and crosses the production `analyze` seam. Tests should describe biological
and QC behaviour in scenario terms rather than reconstructing the instrument row
schema.

## QuantStudio fixture ingest

**QuantStudio fixture ingest** is the test-only path from a workbook fixture through
SheetJS, `parseAoA`, and `analyze`. The repository fixture is de-identified and
portable. A real exported workbook may be supplied explicitly as an optional replay
adapter, but tests must not depend on a user-specific absolute path.

## Analysis diagnostic

An **analysis diagnostic** is a stable `{ code, severity, params }` value emitted by
run QC, calibration guards, or the quality model. Chinese copy is presentation and
is rendered only by the browser or export adapter. Tests assert diagnostic codes and
parameters rather than sentences.

## Release asset manifest

The **release asset manifest** is the single list of canonical browser and offline
files. Sites synchronization and offline packaging consume this manifest; generated
copies under `sites-app/public` are never edited independently.

## CNV analysis result

A **CNV analysis result** contains one canonical copy of normalized measurement
records plus calculated assay, sample, well, calibration, and diagnostic projections.
Calculated wells keep only audit scalars such as source row and source flags; they do
not embed duplicate source or reference records.

## Registration review

A **registration review** is the single decision Module for registration completeness
and manual approval eligibility. The browser and workbook export are adapters over
the same `reviewRegistration` interface; scientific `HOLD` remains distinct from
missing registration fields and human review status.

## Plate layout supplementation

**Plate layout supplementation** updates sample identities by an explicitly
selected plate and physical well. `CopyNumberLayout` accepts named two-dimensional
sheets from file and clipboard adapters; it does not read files or mutate input
records. Missing identities fill directly; replacing existing names requires user
confirmation in the browser. Original instrument names and measurements remain
auditable across repeated corrections. Registration metadata
is fill-only and applied only when the layout was selected before instrument import.
Saved assignments and exported source names keep the correction traceable. Unnamed
measurements remain auditable but do not form an anonymous CN result. A nonblank
sample name is not evidence that the plate identity has been verified. Replacement
recounts samples and clears name-dependent calibration; NTC roles stay on their
original physical wells.

## Sites static delivery

**Sites static delivery** is an adapter for the same browser application used by the
offline package. Its interface is one Worker `fetch`: `/` maps to `index.html` and all
other requests pass to the platform asset adapter. It has no database, authentication,
React, server-rendering, or image-processing responsibility.
