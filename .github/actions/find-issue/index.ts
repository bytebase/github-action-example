import * as core from '@actions/core';

async function run(): Promise<void> {
  const url = core.getInput("url", { required: true })
  const token = core.getInput("token", { required: true })
  const projectId = core.getInput("project-id", { required: true })
  const title = core.getInput("title", { required: true })

  let headers = {
    "Content-Type": "application/json",
    "Accept-Encoding": "deflate, gzip",
    Authorization: "Bearer " + token,
  };

  // TODO: Use search API instead
  // const searchRequest = {
  //   filter: "status == \"OPEN\"",
  //   query: title,
  // };

  // const searchIssue = await fetch(`${url}/v1/projects/${projectId}/issues:search&query=${title}`, {
  //   method: "GET",
  //   headers,
  // });
  // const searchedIssueData = await searchIssue.json();
  // if (searchedIssueData.message) {
  //   throw new Error(searchedIssueData.message);
  // }

  const searchedIssueRes = await fetch(`${url}/v1/projects/${projectId}/issues`, {
    method: "GET",
    headers,
  });

  const searchedIssueData = await searchedIssueRes.json();
  let filtered = searchedIssueData.issues.filter((issue: { title: string }) => issue.title === title);
  if (filtered.length ==0) {
    core.info("No issue found for title" + title)
    return
  }

  let issue;
  if (filtered.length >1) {
    core.warning("Found multiple issues for title " + title + ". Use the latest one \n" + JSON.stringify(filtered, null, 2))
    issue = filtered.reduce((prev : any, current : any) => {
      return new Date(prev.createTime) > new Date(current.createTime) ? prev : current;
    });
  } else {
    core.info("Issue found for title" + title)
    issue = filtered[0]
  }

  core.info(JSON.stringify(issue, null, 2))
  const issueURL = `${url}/projects/${projectId}/issues/${issue.uid}`
  core.info("Visit " + issueURL)
  core.setOutput('issue', issue);
}

run();
