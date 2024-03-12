import * as core from '@actions/core';
import * as github from '@actions/github';
import { promises as fs } from 'fs';
import * as glob from 'glob';

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

// Use a deterministic way to generate the change id. Thus we can derive the same id when we want to
// change.
function generateChangeId(repo: string, pr: string, version: string) {
  // Replace all non-alphanumeric characters with hyphens
  return `ch-${repo}-pr${pr}-${version}`.replace(/[^a-zA-Z0-9]/g, '-');
}

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
  let changes: Change[] = [];
  for (const file of sqlFiles) {
    const content = await fs.readFile(file);
    const version = file.split("_")[0]
    changes.push({
      id: generateChangeId(repo, prNumber.toString(), version),
      database,
      file,
      content: Buffer.from(content).toString(),
      // filename should follow <<version>>_xxxx
      schemaVersion: version,
    });
  }

  let issue = await findIssue(title);
  if (issue) {
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

    const issueURL = `${url}/projects/${projectId}/issues/${issue.uid}`
    core.info("Successfully updated issue at " + issueURL)
  } else {
    // Create plan
    let plan = await createPlan(changes, title, description);

    // Create issue
    issue = await createIssue(plan.name, assignee, title, description);

    // Create rollout
    await createRollout(plan.name)

    const issueURL = `${url}/projects/${projectId}/issues/${issue.uid}`
    core.info("Successfully created issue at " + issueURL)
  }
}

run();

async function createPlan(changes: Change[], title: string, description: string) : Promise<any> {
  try {
    // Initialize an empty array for the specs
    let specs: any[] = [];

    // Populate the specs array with the desired structure, inserting each base64-encoded content
    for (const change of changes) {
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
    core.info("No issue found for title " + title)
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
