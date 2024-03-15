import * as core from '@actions/core';
import * as github from '@actions/github';
import { promises as fs } from 'fs';
import * as glob from 'glob';
import * as path from 'path';
import { createPatch } from 'diff';

let headers = {};
let projectUrl = ""

interface Change {
  // Specify an id so that we can update the change afterwards.
  id: string;
  file: string;
  content: string;
  // Extract from the filename. If filename is 123_init.sql, then the version is 123.
  schemaVersion: string;
  status: string;
}

// Use a deterministic way to generate the change id and schema version.
// Thus later we can derive the same id when we want to check the change.
function generateChangeIdAndSchemaVersion(repo: string, pr: string, file: string) : { id: string; version: string} {
  // filename should follow yyy/<<version>>_xxxx
  const version = path.basename(file).split("_")[0]
  // Replace all non-alphanumeric characters with hyphens
  return { id: `ch-${repo}-pr${pr}-${version}`.replace(/[^a-zA-Z0-9]/g, '-'), version};
}

async function run(): Promise<void> {
  const githubToken = core.getInput('github-token', { required: true });
  const pattern = core.getInput('pattern', { required: true });
  const url = core.getInput("url", { required: true });
  const token = core.getInput("token", { required: true });
  const projectId = core.getInput("project-id", { required: true });
  const title = core.getInput("title", { required: true });
  const extraHeaders: string = core.getInput('headers');

  headers = extraHeaders ? JSON.parse(extraHeaders) : {};
  headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
    ...headers
  };

  projectUrl = `${url}/v1/projects/${projectId}`

  const changes = await collectChanges(githubToken, pattern);

  // Sample issue
  //
  // {
  //   "name": "projects/example/issues/129",
  //   "uid": "129",
  //   "title": "[bytebase/ci-example#6] chore: add migration files",
  //   "description": "Triggered by https://github.com/bytebase/ci-example/pull/6 chore: add migration files",
  //   "type": "DATABASE_CHANGE",
  //   "status": "OPEN",
  //   "assignee": "",
  //   "assigneeAttention": false,
  //   "approvers": [
  //     {
  //       "status": "APPROVED",
  //       "principal": "users/ci@service.bytebase.com"
  //     }
  //   ],
  //   "approvalTemplates": [
  //     {
  //       "flow": {
  //         "steps": [
  //           {
  //             "type": "ANY",
  //             "nodes": [
  //               {
  //                 "type": "ANY_IN_GROUP",
  //                 "role": "roles/ci-approver-gmul"
  //               }
  //             ]
  //           }
  //         ]
  //       },
  //       "title": "CI Approval Flow",
  //       "description": "CI call API to approve",
  //       "creator": ""
  //     }
  //   ],
  //   "approvalFindingDone": true,
  //   "approvalFindingError": "",
  //   "subscribers": [],
  //   "creator": "users/ci@service.bytebase.com",
  //   "createTime": "2024-03-10T17:24:48Z",
  //   "updateTime": "2024-03-10T17:42:34Z",
  //   "plan": "projects/example/plans/132",
  //   "rollout": "projects/example/rollouts/122",
  //   "grantRequest": null,
  //   "releasers": [
  //     "roles/projectOwner",
  //     "users/ci@service.bytebase.com"
  //   ],
  //   "riskLevel": "RISK_LEVEL_UNSPECIFIED",
  //   "taskStatusCount": {
  //     "NOT_STARTED": 2
  //   }
  // }
  const issue = await findIssue(title);
  if (!issue) {
    throw new Error(`No issue found for title ${title}`)
  }

  if (issue.status !== "DONE") {
    core.setFailed(`Issue status is not DONE. Current status is ${issue.status}.`)
  }
  
  core.info("Issue:\n" + JSON.stringify(issue, null, 2))
  core.setOutput('issue', issue);
  // Sample plan. A plan is the rollout blueprint containing stages, and each stage contains tasks.
  //
  // {
  //   "name": "projects/example/plans/132",
  //   "uid": "132",
  //   "issue": "",
  //   "title": "[bytebase/ci-example#6] chore: add migration files",
  //   "description": "Triggered by https://github.com/bytebase/ci-example/pull/6 chore: add migration files",
  //   "steps": [
  //     {
  //       "title": "",
  //       "specs": [
  //         {
  //           "earliestAllowedTime": null,
  //           "id": "b930f84c-6728-4145-818b-14d562ec0bc8",
  //           "changeDatabaseConfig": {
  //             "target": "instances/prod-instance/databases/example",
  //             "sheet": "projects/example/sheets/251",
  //             "type": "MIGRATE",
  //             "schemaVersion": "",
  //             "rollbackEnabled": false,
  //             "ghostFlags": {},
  //             "preUpdateBackupDetail": {
  //               "database": ""
  //             }
  //           }
  //         },
  //         {
  //           "earliestAllowedTime": null,
  //           "id": "8bec113c-1ae2-44e9-a85a-16b0844f7b9b",
  //           "changeDatabaseConfig": {
  //             "target": "instances/prod-instance/databases/example",
  //             "sheet": "projects/example/sheets/252",
  //             "type": "MIGRATE",
  //             "schemaVersion": "",
  //             "rollbackEnabled": false,
  //             "ghostFlags": {},
  //             "preUpdateBackupDetail": {
  //               "database": ""
  //             }
  //           }
  //         }
  //       ]
  //     }
  //   ]
  // }
  if (issue.plan) {
    const components = issue.plan.split("/");
    const planUid = components[components.length - 1];
    const planRes = await fetch(`${url}/v1/projects/${projectId}/plans/${planUid}`, {
      method: "GET",
      headers,
    });
    const planData = await planRes.json();
    if (planData.message) {
      throw new Error(planData.message);
    }
    core.info("Plan:\n" + JSON.stringify(planData, null, 2))
    core.setOutput('plan', planData);
  }

  // Sample rollout. A rollout contains one or multiple stages, and each stage contains multiple
  // tasks. The task status field indicates whether that task has finished/failed/skipped.
  //
  // {
  //   "name": "projects/example/rollouts/122",
  //   "uid": "122",
  //   "plan": "",
  //   "title": "Rollout Pipeline",
  //   "stages": [
  //     {
  //       "name": "projects/example/rollouts/122/stages/123",
  //       "uid": "123",
  //       "environment": "environments/prod",
  //       "title": "Prod Stage",
  //       "tasks": [
  //         {
  //           "name": "projects/example/rollouts/122/stages/123/tasks/137",
  //           "uid": "137",
  //           "title": "DDL(schema) for database \"example\"",
  //           "specId": "b930f84c-6728-4145-818b-14d562ec0bc8",
  //           "status": "NOT_STARTED",
  //           "skippedReason": "",
  //           "type": "DATABASE_SCHEMA_UPDATE",
  //           "blockedByTasks": [],
  //           "target": "instances/prod-instance/databases/example",
  //           "databaseSchemaUpdate": {
  //             "sheet": "projects/example/sheets/251",
  //             "schemaVersion": "20240310172448"
  //           }
  //         },
  //         {
  //           "name": "projects/example/rollouts/122/stages/123/tasks/138",
  //           "uid": "138",
  //           "title": "DDL(schema) for database \"example\"",
  //           "specId": "8bec113c-1ae2-44e9-a85a-16b0844f7b9b",
  //           "status": "NOT_STARTED",
  //           "skippedReason": "",
  //           "type": "DATABASE_SCHEMA_UPDATE",
  //           "blockedByTasks": [],
  //           "target": "instances/prod-instance/databases/example",
  //           "databaseSchemaUpdate": {
  //             "sheet": "projects/example/sheets/252",
  //             "schemaVersion": "20240310172448"
  //           }
  //         }
  //       ]
  //     }
  //   ]
  // }
  if (issue.rollout) {
    const components = issue.rollout.split("/");
    const rolloutUid = components[components.length - 1];
    const rolloutRes = await fetch(`${url}/v1/projects/${projectId}/rollouts/${rolloutUid}`, {
      method: "GET",
      headers,
    });
    const rolloutData = await rolloutRes.json();
    if (rolloutData.message) {
      throw new Error(rolloutData.message);
    }
    core.info("Rollout:\n" + JSON.stringify(rolloutData, null, 2))
    core.setOutput('rollout', rolloutData);

    for (const stage of rolloutData.stages) {
      for (const task of stage.tasks) {

        let matchedChange;
        for (const change of changes) {
          if (task.specId === change.id && task.databaseSchemaUpdate.schemaVersion === change.schemaVersion) {
            matchedChange = change;
            if (task.status != "DONE") {
              core.setFailed(`${change.file} rollout status is not DONE. Current status is ${task.status}.`)
            }
            break;
          }
        }

        const components = task.databaseSchemaUpdate.sheet.split("/");
        const sheetUid = components[components.length - 1];
        // Fetch the full content
        const queryParams = new URLSearchParams({"raw": "true"});
        const sheetRes = await fetch(`${projectUrl}/sheets/${sheetUid}?${queryParams}`, {
          method: "GET",
          headers,
        });
        const sheetData = await sheetRes.json();
        if (sheetData.message) {
          throw new Error(sheetData.message);
        }

        const actualRolloutContent = Buffer.from(sheetData.content, 'base64').toString()
        if (matchedChange) {
          if (matchedChange.content == actualRolloutContent) {
            matchedChange.status = task.status;
          } else {
            // This means the PR content is different from the Bytebase issue content.
            // It could be that Bytebase issue content is manually changed by someone.
            core.setFailed(`Migration mismatch for ${matchedChange.file} with task ${task.title} under stage ${stage.title}`)
            core.setFailed(createPatch('difference', matchedChange.content, actualRolloutContent, matchedChange.file, task.title));
          }
        } else {
          // This means Bytebase contains a task not found in the PR
          core.setFailed(`Unexpected task ${task.title} under stage ${stage.title} and content ${actualRolloutContent}`)
        }
      }
    }

    // Check if there are any PR changes not found in the rollout
    for (const change of changes) {
      let hasMatch = false;
      for (const stage of rolloutData.stages) {
        for (const task of stage.tasks) {
          if (task.specId === change.id && task.databaseSchemaUpdate.schemaVersion === change.schemaVersion) {
            hasMatch = true;
            break;
          }
        }
      }
      if (!hasMatch) {
        core.setFailed(`Migration ${change.file} not found in the rollout`)
      }
    }

    // Sample rollout details
    //
    // [
    //   {
    //     "id": "ch-ci-example-pr11-1001",
    //     "file": "migrations/1001_init.up.sql",
    //     "content": "CREATE TABLE \"user\" (\n  \"id\" SERIAL NOT NULL,\n  \"firstName\" character varying NOT NULL,\n  \"lastName\" character varying NOT NULL,\n  \"age\" integer NOT NULL,\n  CONSTRAINT \"PK_cace4a159ff9f2512dd42373760\" PRIMARY KEY (\"id\")\n);",
    //     "schemaVersion": "1001",
    //     "status": "DONE"
    //   },
    //   {
    //     "id": "ch-ci-example-pr11-1002",
    //     "file": "migrations/1002_change.up.sql",
    //     "content": "ALTER TABLE \"user1\" DROP COLUMN \"age\";\nALTER TABLE \"user1\" ADD \"address\" character varying;\nALTER TABLE \"user1\" ADD \"gender\" character varying NOT NULL;",
    //     "schemaVersion": "1002",
    //     "status": "NOT_STARTED"
    //   }
    // ]
    core.info("Rollout details:\n" + JSON.stringify(changes, null, 2))
    core.setOutput("rollout-details", changes);
  }
  
  const issueURL = `${url}/projects/${projectId}/issues/${issue.uid}`
  core.info("Visit " + issueURL)
}

run();

async function findIssue(title: string) : Promise<any> {
  const issues = await listAllIssues(`${projectUrl}/issues`, title);

  if (issues.length == 0) {
    return null;
  }
  
  let issue;
  if (issues.length >1) {
    core.warning("Found multiple issues for title " + title + ". Use the latest one \n" + JSON.stringify(issues, null, 2))
    issue = issues.reduce((prev : any, current : any) => {
      return new Date(prev.createTime) > new Date(current.createTime) ? prev : current;
    });
  } else {
    core.info("Issue found for title" + title)
    issue = issues[0]
  }
  return issue;
}

async function listAllIssues(endpoint: string, title: string) {
  // Function to recursively fetch pages
  async function fetchPage(accumulatedData: any[] = [], pageToken?: string): Promise<any[]> {
      // Update the query parameters with the next_page_token if it exists
      const queryParams = new URLSearchParams();
      if (pageToken) {
        queryParams.set('page_token', pageToken);
      }

      const response = await fetch(`${endpoint}?${queryParams}`, {
          method: 'GET',
          headers,
      });

      const data = await response.json();
      if (data.message) {
        throw new Error(data.message);
      }

      // Filter issues by title
      let filtered = data.issues.filter((issue: { title: string }) => issue.title === title);
      // Combine the data from this page with the accumulated data
      const newData = accumulatedData.concat(filtered || []);

      if (data.next_page_token) {
          // If there's a next page, recurse with the new token and the combined data
          return fetchPage(newData, data.next_page_token);
      } else {
          // If there's no next page, return the accumulated data
          return newData;
      }
  }

  // Start fetching from the first page
  return fetchPage();
}

async function collectChanges(githubToken: string, pattern: string) : Promise<Change[]> {
  const octokit = github.getOctokit(githubToken);
  const githubContext = github.context;
  const { owner, repo } = githubContext.repo;
  const prNumber = githubContext.payload.pull_request?.number;
  if (!prNumber) {
    throw new Error('Could not get PR number from the context; this action should only be run on pull_request events.');
  }

  let allChangedFiles: string[]  = [];
  let page = 0;
  let fileList;

  // Iterate through all pages of the API response
  do {
    page++;
    fileList = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });

    allChangedFiles.push(...fileList.data.map((file: { filename: any; }) => file.filename));
  } while (fileList.data.length !== 0);

  // Use glob.sync to synchronously match files against the pattern
  const matchedFiles = glob.sync(pattern, { nodir: true });

  // Filter matchedFiles to include only those that are also in allChangedFiles
  const sqlFiles = matchedFiles
    .filter((file: string) => allChangedFiles.includes(file))
    .sort(); 
  
  let changes: Change[] = [];
  for (const file of sqlFiles) {
    const content = await fs.readFile(file);
    const {id, version } = generateChangeIdAndSchemaVersion(repo, prNumber.toString(), file);
    changes.push({
      id,
      file,
      content: Buffer.from(content).toString(),
      schemaVersion: version,
      status: "",
    });
  }

  return changes;
}