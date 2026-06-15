## Tasks

- [ ] Add the large-file ingest spec coverage for eager small files, deferred large files, and cancelable ingest.
- [ ] Split JSON ingest from matching so large files can parse in the worker and commit before matching runs.
- [ ] Preserve the previous dataset until the new ingest commits successfully.
- [ ] Add loading-modal cancel control and visible ingest-phase messaging.
- [ ] Add named regression coverage for threshold-crossing JSON ingest and cancel behavior.
- [ ] Run `npm run check`, `npm run check:windows`, and `npm run smoke:ui:local`.
