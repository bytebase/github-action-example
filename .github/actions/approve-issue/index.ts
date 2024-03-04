import * as core from '@actions/core';

async function run(): Promise<void> {
  const url = core.getInput("url", { required: true })
  const token = core.getInput("token", { required: true })
  const issueUID = core.getInput("issue_uid", { required: true })
  const comment = core.getInput("comment")

  let headers = {
    "Content-Type": "application/json",
    "Accept-Encoding": "deflate, gzip",
    Authorization: "Bearer " + token,
  };

  const approveRequest = {
    comment,
  };

  const approvedIssue = await fetch(`${url}/projects/-/issues/${issueUID}:approve`, {
    method: "POST",
    body: JSON.stringify(approveRequest),
    headers,
  });
  const approvedIssueData = await approvedIssue.json();
  if (approvedIssueData.message) {
    throw new Error(approvedIssueData.message);
  }
}

run();
