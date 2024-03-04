import * as core from '@actions/core';

async function run(): Promise<void> {
  const endpoint = core.getInput("endpoint", { required: true })
  const token = core.getInput("token", { required: true })
  const issue_id = core.getInput("issue_id", { required: true })
  const comment = core.getInput("comment")

  let headers = {
    "Content-Type": "application/json",
    "Accept-Encoding": "deflate, gzip",
    // "CF-Access-Client-Id": core.getInput("zerotrust_bytebase_client_id", { required: true }),
    // "CF-Access-Client-Secret": core.getInput("zerotrust_bytebase_client_secret", { required: true }),
    Authorization: "Bearer " + token,
  };

  const approveRequest = {
    comment,
  };

  const approvedIssue = await fetch(`${endpoint}/projects/-/issues/${issue_id}:approve`, {
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
