# App versioning and database status plan

## Outcome

Every packaged TallyStick build has a human-readable release version and a
strictly increasing build number.  The Transactions view identifies both the
running app build and the database schema that it opened.

The first release under this plan is:

```text
TallyStick v0.4.0.0001
Database schema 8
```

The visible header format is:

```text
TALLYSTICK                                      v0.4.0.0001 · Database schema 8
Example Outfitters LLC                                           [Company settings]
```

The metadata sits at the right margin, above the Company settings button. It
is shown only while **Transactions** is
the active workspace. It is informative text, not a control and not an error
status.

## Version policy

Use two independent values:

| Value | Example | Meaning | When it changes |
| --- | --- | --- | --- |
| Release version | `0.4.0` | Product release level | Deliberately, when a feature release or bug-fix release is prepared |
| Build number | `1`, `2`, `3` | Exact packaged artifact | Automatically, once for every successful packaging invocation |
| Database schema | `8` | On-disk SQLite structure | Only when a compatible migration is added |

Release versions follow pre-1.0 Semantic Versioning:

- `0.4.0` — a meaningful feature release.
- `0.4.1` — a bug-fix-only release.
- `0.5.0` — the next feature release.
- `1.0.0` — the first stable/public release.

The build number must never be reset when the release version changes. This
makes `build 47` unambiguous in bug reports, backups, screenshots, and a
packaged `.app` even if two people build the same release branch.

The Transactions header combines the two values as
`v<releaseVersion>.<four-digit-buildNumber>`. The fourth dotted component is
a display convention, not a fourth Semantic Versioning component.

## Single source of truth

1. Add a tracked, small release manifest at
   `site/release-metadata.json`:

   ```json
   {
     "releaseVersion": "0.4.0",
     "buildNumber": 1
   }
   ```

2. Do not use `package.json`, Electron's `Info.plist`, an Angular constant,
   and a release filename as independent sources. They are generated outputs
   of this manifest.

3. The current database schema remains authoritative in
   `site/src/shared/schema-version.ts`. Do not copy `8` into release metadata.
   The UI imports the shared constant, so the displayed number is the schema
   actually supported by the running source.

## Build workflow

1. Add `site/scripts/prepare-desktop-build.mjs`. It reads and validates the
   manifest before any renderer or Electron compilation:

   - release version must be numeric `major.minor.patch`;
   - build number must be a positive integer;
   - increment the build number atomically;
   - write the incremented manifest only after validation;
   - generate the tracked `src/shared/app-build.ts` module, exporting the release version and
     build number;
   - print `Packaging TallyStick v0.4.0.0002` so the exact artifact is
     obvious in terminal logs.

2. Make `npm run desktop:package` invoke this preparation script **before**
   `ng build` and desktop-host compilation. Ordinary commands such as
   `npm run build`, `npm run test:ci`, and `npm run desktop:smoke` must not
   change a build number.

3. Update `package-desktop.mjs` to read the same prepared metadata and set the
   packaged macOS values:

   - `CFBundleShortVersionString`: `0.4.0`
   - `CFBundleVersion`: the numeric build number, such as `2`
   - package terminal label: `TallyStick v0.4.0.0002` while retaining
     the stable launch directory `release/TallyStick-darwin-arm64`

   This distinguishes the release users recognize from the monotonically
   increasing macOS build identity without breaking the stable local launcher
   path.

4. Add `npm run release:set-version -- 0.4.1` for an intentional release bump.
   It validates the supplied SemVer value, changes only `releaseVersion`, and
   leaves `buildNumber` alone. It must reject malformed versions and lower
   versions unless an explicit maintainer-only override is supplied.

5. Commit `release-metadata.json` and generated build metadata together with
   the source change that produced the package. The packaged `.app` remains a
   build artifact and is not committed. Tag approved releases as `v0.4.0`.

## Transactions-header implementation

1. Create an `AppBuildInfo` value from the generated app-build module and the
   shared `CURRENT_SQLITE_SCHEMA_VERSION` constant. It has:

   ```ts
   { releaseVersion: string; buildNumber: number; databaseSchemaVersion: number }
   ```

2. Expose that immutable value on `AppComponent`; it must not query, mutate,
   migrate, or inspect the customer's SQLite file merely to render the label.

3. In `app.component.html`, render the metadata only for
   `workspaceView === 'TRANSACTIONS'`. Place it in the top-bar metadata row:
   at the right margin directly above the Company settings action. Keep the
   company name and existing Ready/error status in their
   present semantic roles.

4. Add responsive CSS in `app.component.scss`:

   - one compact line on wide windows;
   - wraps below the wordmark without overlapping the Company settings button
     at the minimum supported window width;
   - uses subdued text treatment so it is available for support but does not
     compete with warnings/errors;
   - remains readable at system text scaling and with navigation collapsed.

5. Accessibility text should read naturally, for example:
   `TallyStick version 0.4.0.0002, database schema 8.`
   Do not expose an internal git hash, user-data path, company ID, or database
   revision in this header.

## Guardrails and verification

1. Unit-test version parsing, incrementing, invalid-manifest rejection,
   release bump validation, and that non-package build/test scripts do not
   alter the manifest.
2. Test two package preparations sequentially: build `n`, then build `n+1`.
   Verify the release version is unchanged and no build number is reused.
3. Inspect the packaged `Info.plist` to prove that its short version and build
   version equal the manifest-generated values.
4. Add `AppComponent` tests proving the metadata is visible in Transactions,
   absent in Chart/Rules/Reports/Cash Flow/Balance Sheet/Backups, and that the
   displayed schema comes from the shared schema constant.
5. Manually check wide and minimum-size windows in the packaged macOS app.
6. Run `npm run build`, relevant unit tests, `npm run test:desktop-host`,
   `npm run desktop:package`, and `git diff --check`.

## Non-goals

- Do not increment versions for browser-only development builds or test runs.
- Do not show per-company database paths, database revision hashes, or backup
  timestamps in the Transactions header.
- Do not conflate application build number with database schema version.
- Do not create a schema migration solely to support this display.
