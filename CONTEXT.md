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
