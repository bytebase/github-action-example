import * as core from '@actions/core';

let headers = {};
let projectUrl = ""

async function run(): Promise<void> {
  const url = core.getInput("url", { required: true })
  const token = core.getInput("token", { required: true })
  const projectId = core.getInput("project-id", { required: true })
  const title = core.getInput("title", { required: true })
  const comment = core.getInput("comment")
  const extraHeaders: string = core.getInput('headers');
  
  headers = extraHeaders ? JSON.parse(extraHeaders) : {};
  headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
    ...headers
  };

  projectUrl = `${url}/v1/projects/${projectId}`

  const issue = await findIssue(title);

  if (issue) {
    const approveRequest = {
      comment,
    };
  
    const approvedIssue = await fetch(`${projectUrl}/issues/${issue.uid}:approve`, {
      method: "POST",
      body: JSON.stringify(approveRequest),
      headers,
    });
    const approvedIssueData = await approvedIssue.json();
    if (approvedIssueData.message) {
      if (approvedIssueData.code == 3 && approvedIssueData.message.includes("has been approved")) {
        core.warning(`Issue ${issue.uid} has already been approved`)
      } else {
        throw new Error(approvedIssueData.message);
      }
    } else {
      core.info("Issue approved")
    }
    const issueURL = `${url}/projects/${projectId}/issues/${issue.uid}`
    core.info("Visit " + issueURL)
  } else {
    throw new Error(`No issue found for ${title}`)
  }
}

run();

async function findIssue(title: string) : Promise<any> {
  const issues = await listAllIssues(`${projectUrl}/issues`, title);

  if (issues.length == 0) {
    return null;
  }
  
  let issue;
  if (issues.length > 1) {
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
