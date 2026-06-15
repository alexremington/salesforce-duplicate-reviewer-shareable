## Tasks

- [ ] Expand the Contact and Account SOQL definitions to include the standard dedupe fields.
- [ ] Update `OBJECT_CONFIG` so the new headers continue to auto-map without breaking existing aliases.
- [ ] Add Contact row-preparation and scoring support for the new phone variants and mailing address fields.
- [ ] Add contract regressions that verify the expected export columns and mapping behavior.
- [ ] Add a scoring regression that fails without the new Contact fields being consumed.
- [ ] Run `npm run check`, `npm run check:windows`, and `npm run smoke:ui:local`.
