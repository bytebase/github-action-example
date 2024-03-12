import * as core from '@actions/core';

let headers = {};

async function run(): Promise<void> {
  const url = core.getInput("url", { required: true })
  const token = core.getInput("token", { required: true })
  const projectId = core.getInput("project-id", { required: true })
  const title = core.getInput("title", { required: true })

  headers = {
    "Content-Type": "application/json",
    "Accept-Encoding": "deflate, gzip",
    Authorization: "Bearer " + token,
  };

  const issues = await listAllIssues(`${url}/v1/projects/${projectId}/issues`, title);
  
  // Sample issue

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
  
  if (issues.length == 0) {
    core.info("No issue found for title " + title)
    return
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

  core.info("Issue:\n" + JSON.stringify(issue, null, 2))
  core.setOutput('issue', issue);

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
  }
  
  const issueURL = `${url}/projects/${projectId}/issues/${issue.uid}`
  core.info("Visit " + issueURL)
}

run();

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
