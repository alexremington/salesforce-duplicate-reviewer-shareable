# Salesforce Org Selector Simplification Checklist

Use this checklist when manually verifying the selector in a launched Duplicate Reviewer runtime.

## Launch

- Start the app from the normal launcher or local smoke path, not from a synthetic DOM fixture.
- Load a dataset that has a known source org so mismatch behavior can be observed.
- Confirm the `Source` rail is visible and scrollable before checking the selector.

## Selector Shape

- Open the shared org catalog dropdown and confirm each option shows the alias only.
- Confirm no dropdown option includes a host name or `https://` text.
- Confirm the canonical staging alias is `qa-staging` and that `staging` does not appear as a separate option.
- Confirm more than five org entries are visible when the catalog contains them.
- Confirm the separate Alias field is not present.
- Confirm the instance URL appears as read-only text, not an input.
- Confirm the instance URL label is visible and still legible at the current viewport width.

## Interaction

- Choose a different org alias.
- Click `Use org`.
- Confirm the target org label updates.
- Confirm the mismatch warning appears when the selected target org differs from the loaded dataset source.
- Confirm the warning clears again when the target org matches the source org.

## Layout

- Reduce the viewport to a narrow mobile width.
- Confirm the selector stays inside the `Source` rail without horizontal spill.
- Confirm the `Source`, `Match Controls`, and `Match Groups` toggles remain visible and hit-testable.
- Confirm the rail still has a working scroll path when content extends below the viewport.
