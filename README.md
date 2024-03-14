# github-action-example

Sample github custom actions to call Bytebase API to coordinate the schema migration in Bytebase with the GitHub PR workflow.

A typical workflow works like this:

1. Create PR containing both code change and schema migration for review.
1. PR approved.
1. Rollout the schema migration.
1. Merge the PR and kicks of the pipeline to release the application.

These are the building blocks to achieve this workflow:

* [login](https://github.com/bytebase/github-action-example/tree/main/.github/actions/login)
authenticates with Bytebase and obtain the token.
* [sql-review](https://github.com/bytebase/github-action-example/tree/main/.github/actions/sql-review) 
checks the configured SQL Review policy and reports inline violations if found.
![sql-review](https://raw.githubusercontent.com/bytebase/github-action-example/main/assets/step2-create-bytebase-issue.webp)
* [upsert-issue](https://github.com/bytebase/github-action-example/tree/main/.github/actions/upsert-issue) creates or updates the Bytebase migration issue for the PR. If you change the migration script during the PR process, this action will update the corresponding Bytebase migration task as well. And it will return error if you attempt to update a migration script after the corresponding migration task has been rolled out.
* [check-issue-status](https://github.com/bytebase/github-action-example/tree/main/.github/actions/check-issue-status) reports the overall issue status, as well as the rollout status for each
migration file. It will also report error if the Bytebase rollout content mismatches with the migration file. **You can use this action to block the PR until all migrations complete**.
* [approve-issue](https://github.com/bytebase/github-action-example/tree/main/.github/actions/approve-issue) approves the Bytebase migration issue. **You can use this to propagate the PR approval to Bytebase**
* [search-issue](https://github.com/bytebase/github-action-example/tree/main/.github/actions/search-issue) searches the Bytebase migration issue.

## Sample Workflow - Create Migration Issue on PR Approval

* Configure sql-review on PR change. Thus any SQL review violation will block the PR.
* Configure check-issue-status on PR change. Thus PR will be blocked until migration completes.
* Configure upsert-issue on PR approval. Creates the migration after approval, and even migration
script changes afterwards, the migration issue will also be updated accordingly.

## Sample Workflow - Create Migration Issue on PR Creation

* Configure sql-review on PR change. Thus any SQL review violation will block the PR.
* Configure check-issue-status on PR change. Thus PR will be blocked until migration completes.
* Configure upsert-issue on PR creation. Whenever the migration script changes, the migration issue will also be updated accordingly.
* Configure approve-issue on PR approval. Whenever the PR is approved, it will in turn approve
the Bytebase rollout.
