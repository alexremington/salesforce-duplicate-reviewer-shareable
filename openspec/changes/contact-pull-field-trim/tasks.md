## Tasks

- [ ] Trim `AccountId`, `Title`, and `Department` from the staging and prod Contact SOQL files.
- [ ] Update the reviewer contract regression so it asserts the trimmed Contact export schema and still proves the dataset loads and scores normally.
- [ ] Update the scheduler contract regression so the seeded Contacts job query reflects the trimmed field set.
- [ ] Run the reviewer repo checks and smoke coverage.
- [ ] Run the scheduler repo checks that cover the prod/staging Contacts job wiring.
