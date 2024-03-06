import * as core from '@actions/core';

async function run(): Promise<void> {
  const url = core.getInput("url", { required: true })
  const token = core.getInput("token", { required: true })
  const projectId = core.getInput("project-id", { required: true })
  const database = core.getInput("database", { required: true })
  const statement = core.getInput("statement", { required: true })
  const title = core.getInput("title", { required: true })
  const assignee = core.getInput("assignee")
  const description = core.getInput("description")

  const projectUrl = `${url}/v1/projects/${projectId}`
  let headers = {
    "Content-Type": "application/json",
    "Accept-Encoding": "deflate, gzip",
    Authorization: "Bearer " + token,
  };

  // Create sheet
  const newSheet = {
    database,
    title,
    content: Buffer.from(statement).toString("base64"),
    type: `TYPE_SQL`,
  };

  const createdSheet = await fetch(`${projectUrl}/sheets`, {
    method: "POST",
    body: JSON.stringify(newSheet),
    headers,
  });
  const createdSheetData = await createdSheet.json();
  if (createdSheetData.message) {
    throw new Error(createdSheetData.message);
  }

  // Create plan
  const newPlan = {
    steps: [
      {
        specs: [
          {
            change_database_config: {
              target: database,
              type: `MIGRATE`,
              sheet: createdSheetData.name,
            },
          },
        ],
      },
    ],
    title,
    description: "MIGRATE",
  };

  const createdPlan = await fetch(`${projectUrl}/plans`, {
    method: "POST",
    body: JSON.stringify(newPlan),
    headers,
  });

  const createdPlanData = await createdPlan.json();
  if (createdPlanData.message) {
    throw new Error(createdPlanData.message);
  }

  // Create issue
  const newIssue = {
    approvers: [],
    approvalTemplates: [],
    subscribers: [],
    title,
    description,
    type: "DATABASE_CHANGE",
    assignee,
    plan: createdPlanData.name,
  };

  const res = await fetch(`${projectUrl}/issues`, {
    method: "POST",
    body: JSON.stringify(newIssue),
    headers,
  });

  const createdIssueData = await res.json();
  if (createdIssueData.message) {
    throw new Error(createdIssueData.message);
  }

  // Create rollout
  const newRollout = {
    plan: createdPlanData.name,
  }
  const createdRollout = await fetch(`${projectUrl}/rollouts`, {
    method: "POST",
    body: JSON.stringify(newRollout),
    headers,
  });

  const createdRolloutData = await createdRollout.json();

  if (createdRolloutData.message) {
    throw new Error(createdRolloutData.message);
  }

  const issueURL = `${url}/projects/${projectId}/issues/${createdIssueData.uid}`
  core.info("Successfully created issue at " + issueURL)
}

run();
