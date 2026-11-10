## What this does

<!-- One or two sentences in plain language: what can the app do now that it couldn't before? -->

## How it was tested

<!-- Tests added or updated, and anything checked by hand. -->

## Needs owner attention

<!-- Tick anything this PR touches. Leave unticked if none apply. -->

- [ ] Database schema or migrations (`src/db/schema.ts`, `drizzle/`). Migrations run automatically on deploy.
- [ ] Changes or removes something an existing endpoint returns or accepts (could break app versions already on phones)
- [ ] Auth middleware, rate limiting, or CORS
- [ ] Environment variables or `src/config/`
- [ ] New dependency
- [ ] Paired with an iOS change (link the `Nippardation` PR):

## Checklist

- [ ] Targets `staging`
- [ ] Backend CI is green on the latest commit
- [ ] One feature only; no unrelated changes
- [ ] `docs/API.md` updated if an endpoint changed
