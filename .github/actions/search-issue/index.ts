import * as core from '@actions/core';
import * as github from '@actions/github';

let headers = {};

async function searchAllIssues(endpoint: string, initialQueryParams: URLSearchParams = new URLSearchParams()) {
  // Function to recursively fetch pages
  async function fetchPage(accumulatedData: any[] = [], pageToken?: string): Promise<any[]> {
      // Update the query parameters with the next_page_token if it exists
      if (pageToken) {
          initialQueryParams.set('page_token', pageToken);
      }

      const response = await fetch(`${endpoint}?${initialQueryParams}`, {
          method: 'GET',
          headers,
      });

      const data = await response.json();
      if (data.message) {
        throw new Error(data.message);
      }

      // Combine the data from this page with the accumulated data
      const newData = accumulatedData.concat(data.issues || []);

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

async function run(): Promise<void> {
  const url = core.getInput("url", { required: true })
  const token = core.getInput("token", { required: true })
  const projectId = core.getInput("project-id", { required: true })
  const database = core.getInput("database", { required: true })
  const title = core.getInput("title")
  const extraHeaders: string = core.getInput('headers');

  headers = extraHeaders ? JSON.parse(extraHeaders) : {};
  headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
    ...headers
  };

  const queryParams = new URLSearchParams({
    filter: `status="OPEN" && database=${database}`,
  });

  if (title) {
    queryParams.set("query", title)
  }

  const issues = await searchAllIssues(`${url}/v1/projects/${projectId}/issues:search`, queryParams);
  
  if (issues.length == 0) {
    core.info("No issue found for " + decodeURIComponent(queryParams.toString()));
  } else {
    core.info(issues.length + " issue(s) found for " + decodeURIComponent(queryParams.toString()));
  }

  issues.forEach((issue) => {
    core.info("Issue URL " + `${url}/projects/${projectId}/issues/${issue.uid}`);
  })

  core.setOutput('issues', issues);
}

run();
