import * as core from '@actions/core';
import * as github from '@actions/github';
import { promises as fs } from 'fs';
import * as glob from 'glob';
import { v4 as uuidv4 } from 'uuid';

let headers = {};
let projectUrl = ""

async function run(): Promise<void> {
  const githubToken = core.getInput('github-token', { required: true });
  const pattern = core.getInput('pattern', { required: true });
  const octokit = github.getOctokit(githubToken);
  const url = core.getInput("url", { required: true })
  const token = core.getInput("token", { required: true })
  const projectId = core.getInput("project-id", { required: true })
  const database = core.getInput("database", { required: true })
  const title = core.getInput("title", { required: true })
  const description = core.getInput("description", { required: true })
  const assignee = core.getInput("assignee")

  headers = {
    "Content-Type": "application/json",
    "Accept-Encoding": "deflate, gzip",
    Authorization: "Bearer " + token,
  };
  projectUrl = `${url}/v1/projects/${projectId}`
  
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
  const sqlFiles = matchedFiles.filter((file: string) => allChangedFiles.includes(file)); 
  let sheetIds: string[] = [];
  for (const file of sqlFiles) {
    const content = await fs.readFile(file);
    const requestBody = {
      database,
      title,
      content: Buffer.from(content).toString("base64"),
      type: `TYPE_SQL`,
    };

    core.debug(file);
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
    sheetIds.push(createdSheetData.name);
  }

  // Create plan
  let plan = await createPlan(sheetIds, database, title, description);

  // Create issue
  let issue = await createIssue(plan.name, assignee, title, description);

  // Create rollout
  await createRollout(plan.name)

  const issueURL = `${url}/projects/${projectId}/issues/${issue.uid}`
  core.info("Successfully created issue at " + issueURL)
}

run();

async function createPlan(sheetIds: string[], database: string, title: string, description: string) : Promise<any> {
  try {
    // Initialize an empty array for the specs
    let specs: any[] = [];

    // Populate the specs array with the desired structure, inserting each base64-encoded content
    sheetIds.forEach(sheetId => {
      const UUID = uuidv4();
      const spec = {
        id: UUID,
        change_database_config: {
          target: database,
          sheet: sheetId,
          type: "MIGRATE"
        }
      };
      specs.push(spec);
    });

    // Construct the final JSON structure with the specs array
    const requestBody = {
      steps: [
        {
          specs: specs
        }
      ],
      title,
      description,
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

async function createIssue(planName: string, assignee: string, title: string, description: string) : Promise<any> {
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
