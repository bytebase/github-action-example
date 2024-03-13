import * as core from '@actions/core';

async function run(): Promise<void> {
  const url = core.getInput("url", { required: true })
  const token = core.getInput("token", { required: true })
  const projectId = core.getInput("project-id", { required: true })
  const issueUID = core.getInput("issue-uid", { required: true })
  const comment = core.getInput("comment")
  const extraHeaders: string = core.getInput('headers');
  
  let headers: HeadersInit = extraHeaders ? JSON.parse(extraHeaders) : {};
  headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
    ...headers
  };

  const approveRequest = {
    comment,
  };

  const approvedIssue = await fetch(`${url}/v1/projects/${projectId}/issues/${issueUID}:approve`, {
    method: "POST",
    body: JSON.stringify(approveRequest),
    headers,
  });
  const approvedIssueData = await approvedIssue.json();
  if (approvedIssueData.message) {
    if (approvedIssueData.code == 3 && approvedIssueData.message.includes("has been approved")) {
      core.warning("Issue " + issueUID + " has already been approved")
    } else {
      throw new Error(approvedIssueData.message);
    }
  } else {
    core.info("Issue approved")
  }
  const issueURL = `${url}/projects/${projectId}/issues/${issueUID}`
  core.info("Visit " + issueURL)
}

run();
