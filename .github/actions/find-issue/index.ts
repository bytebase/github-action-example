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
  if (searchedIssueData.issues.length ==0) {
    core.info("No issue found for title" + title)
  }
  if (searchedIssueData.issues.length >1) {
    core.warning("Found multiple issues for title " + title + ". Use the latest one \n" + JSON.stringify(searchedIssueData.issues, null, 2))
    const latestItem = searchedIssueData.issues.reduce((prev : any, current : any) => {
      return new Date(prev.createTime) > new Date(current.createTime) ? prev : current;
    });
    core.info(JSON.stringify(latestItem, null, 2))
    core.setOutput('issue_uid', latestItem.uid); 
  } else {
    core.info("Issue found for title" + title)
    core.info(JSON.stringify(searchedIssueData.issues[0], null, 2))
    core.setOutput('issue_uid', searchedIssueData.issues[0].uid); 
  }
}

run();
