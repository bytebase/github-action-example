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
  database: string;
  file: string;
  content: string;
  // Extract from the filename. If filename is 123_init.sql, then the version is 123.
  schemaVersion: string;
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
  const url = core.getInput("url", { required: true })
  const token = core.getInput("token", { required: true })
  const projectId = core.getInput("project-id", { required: true })
  const database = core.getInput("database", { required: true })
  const title = core.getInput("title", { required: true })
  const description = core.getInput("description", { required: true })
  const assignee = core.getInput("assignee")
  const extraHeaders: string = core.getInput('headers');

  headers = extraHeaders ? JSON.parse(extraHeaders) : {};
  headers = {
    "Content-Type": "application/json",
    'Authorization': `Bearer ${token}`,
    ...headers
  };

  projectUrl = `${url}/v1/projects/${projectId}`
  
  const changes = await collectChanges(githubToken, database, pattern);

  let issue = await findIssue(title);
  // If found existing issue, then update if migration script changes.
  // Otherwise, create a new issue.
  if (issue) {
    if (issue.plan) {
      await updateIssuePlan(issue, changes, title)
    } else {
      // In theory, every issue must have a plan, otherwise issue creation will return error:
      // {"code":3, "message":"plan is required", "details":[]}
      throw new Error('Missing plan from the existing issue.');
    }
    const issueURL = `${url}/projects/${projectId}/issues/${issue.uid}`
    core.info("Visit " + issueURL)
  } else {
    // Create plan
    let plan = await createPlan(changes, title, description);

    // Create rollout
    let rollout = await createRollout(plan.name)

    // Create issue
    issue = await createIssue(plan.name, rollout.name, assignee, title, description);

    if (issue) {
      const issueURL = `${url}/projects/${projectId}/issues/${issue.uid}`
      core.info("Successfully created issue at " + issueURL)
    }
  }
}

run();

async function collectChanges(githubToken: string, database: string, pattern: string) : Promise<Change[]> {
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
      database,
      file,
      content: Buffer.from(content).toString(),
      schemaVersion: version,
    });
  }

  return changes;
}

async function createPlan(changes: Change[], title: string, description: string) : Promise<any> {
  try {
    // Initialize an empty array for the specs
    let specs: any[] = [];

    // Populate the specs array with the desired structure, inserting each base64-encoded content
    for (const change of changes) {
      const createdSheetData = await createSheet(change, title);
      const spec = {
        id: change.id,
        change_database_config: {
          target: change.database,
          sheet: createdSheetData.name,
          schemaVersion: change.schemaVersion,
          type: "MIGRATE"
        }
      };
      specs.push(spec);
    };

    // Construct the final JSON structure with the specs array
    const requestBody = {
      steps: [
        {
          specs: specs
        }
      ],
      title,
      description,
      vcs_source: {
        vcs_type: "GITHUB",
        pull_request_url:  github.context.payload.pull_request?.html_url
      }
    };

    core.debug("Creating plan with request body: " + JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${projectUrl}/plans`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    const createdPlanData = await response.json();
    if (createdPlanData.message) {
      throw new Error(createdPlanData.message);
    }

    core.info("Plan:" + JSON.stringify(createdPlanData));
    return createdPlanData;
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Failed to create plan');
  }

  return {}
}

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

async function createSheet(change: Change, title: string) : Promise<any> {
  const requestBody = {
    change: change.database,
    title,
    content: Buffer.from(change.content).toString("base64")
  };

  core.debug(change.file);
  core.debug("Creating sheet with request body: " + JSON.stringify(requestBody, null, 2));

  const sheetResponse = await fetch(`${projectUrl}/sheets`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  const createdSheetData = await sheetResponse.json();
  if (createdSheetData.message) {
    throw new Error(createdSheetData.message);
  }
  return createdSheetData
}

async function createIssue(planName: string, rolloutName: string, assignee: string, title: string, description: string) : Promise<any> {
  try {
    const requestBody = {
      approvers: [],
      approvalTemplates: [],
      subscribers: [],
      title: title,
      description,
      type: "DATABASE_CHANGE",
      assignee,
      plan: planName,
      rollout: rolloutName,
    };

    core.debug("Creating issue with request body: " + JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${projectUrl}/issues`, {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers,
    });
  
    const createdIssueData = await response.json();
    if (createdIssueData.message) {
      throw new Error(createdIssueData.message);
    }

    core.info("Issue:" + JSON.stringify(createdIssueData));
    return createdIssueData;
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Failed to create issue');
  }
  return {}
}

async function updateIssuePlan(issue: any, changes: Change[], title: string) : Promise<any> {
  const planComponents = issue.plan.split("/");
  const planUid = planComponents[planComponents.length - 1];
  const planRes = await fetch(`${projectUrl}/plans/${planUid}`, {
    method: "GET",
    headers,
  });
  const planData = await planRes.json();
  if (planData.message) {
    throw new Error(planData.message);
  }
  core.info("Check existing plan for update:\n" + JSON.stringify(planData, null, 2))

  // Currently, Bytebase only allows to in-place update existing spec in the plan steps. And it
  // doesn't allow to add new spec or remove spec. Attempt to add/remove will encounter errors:
  // 
  // {"code":3, "message":"cannot add specs to plan", "details":[]}
  // {"code":3, "message":"cannot remove specs from plan", "details":[]}
  // 
  // Return error if we attempt to add new migration file to the existing issue.
  for (const change of changes) {
    let matchedSpec;
    for (const step of planData.steps) {
      for (const spec of step.specs) {
        if (change.id == spec.id) {
          matchedSpec = spec;
          break;
        }
      }
      if (!matchedSpec) {
        throw new Error(`Bytebase disallow adding new migration file to the existing issue: ${change.file}`);
      }
    }
  }

  // Return error if we attempt to remove migration file from the existing issue.
  for (const step of planData.steps) {
    for (const spec of step.specs) {
      let matchedSpec;
      for (const change of changes) {
        if (change.database == spec.changeDatabaseConfig.target && change.id == spec.id) {
          matchedSpec = spec;
          break;
        }
      }
      if (!matchedSpec) {
        throw new Error('Bytebase disallow removing migration file from the existing issue.');
      }
    }
  }

  const rolloutComponents = issue.rollout.split("/");
  const rolloutUid = rolloutComponents[rolloutComponents.length - 1];
  const rolloutRes = await fetch(`${projectUrl}/rollouts/${rolloutUid}`, {
    method: "GET",
    headers,
  });
  const rolloutData = await rolloutRes.json();
  if (rolloutData.message) {
    throw new Error(rolloutData.message);
  }
  
  let updatePlan = false;
  for (const step of planData.steps) {
    for (const spec of step.specs) {
      for (const change of changes) {
        if (change.database == spec.changeDatabaseConfig.target && change.id == spec.id) {
          const components = spec.changeDatabaseConfig.sheet.split("/");
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

          // If there is a change to the existing migration file, then we create a new sheet and
          // update the plan with the new sheet
          const oldContent = Buffer.from(sheetData.content, 'base64').toString()
          if (change.content != oldContent) {
            core.info("Migration file has changed " + change.file);
            core.info(createPatch('difference', oldContent, change.content));

            // Return error if we attempt to update a rollout task NOT in the following states
            const allowedStates = ["NOT_STARTED", "CANCELED", "FAILED"];
            for (const stage of rolloutData.stages) {
              for (const task of stage.tasks) {
                if (change.id == task.specId) {
                  if (!allowedStates.includes(task.status)) {
                    throw new Error(`Can not update migration file: ${change.file}. Task status ${task.status} not in [${allowedStates.toString()}].`);
                  }
                }
              }
            }
            const createdSheetData = await createSheet(change, title);
            spec.changeDatabaseConfig.sheet = createdSheetData.name;
            updatePlan = true;
          }
          break;
        }
      }
    }
  }

  if (updatePlan) {
    const queryParams = new URLSearchParams({"update_mask": "steps"});
    const planRes = await fetch(`${projectUrl}/plans/${planUid}?${queryParams}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({steps: planData.steps}),
    });
    
    const newPlanData = await planRes.json();
    if (newPlanData.message) {
      throw new Error(newPlanData.message);
    }
    core.info("Updated plan:\n" + JSON.stringify(newPlanData, null, 2));
  } else {
    core.info("Skip plan update. No migration file changed since the last time.");
  }
}

async function createRollout(planName: string) : Promise<any> {
  try {
    const requestBody = {
      plan: planName,
    };

    core.debug("Creating rollout with request body: " + JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${projectUrl}/rollouts`, {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers,
    });
  
    const createdRolloutData = await response.json();
    if (createdRolloutData.message) {
      throw new Error(createdRolloutData.message);
    }

    core.info("Rollout:" + JSON.stringify(createdRolloutData));
    return createdRolloutData;
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Failed to create rollout');
  }
  return {}
}
