import * as core from '@actions/core';
import * as github from '@actions/github';
import { promises as fs } from 'fs';
import * as glob from 'glob';

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('github-token', { required: true });
    const pattern = core.getInput('pattern', { required: true });
    const octokit = github.getOctokit(githubToken);
    const url = core.getInput("url", { required: true })
    const token = core.getInput("token", { required: true })
    const database = core.getInput("database", { required: true })

    const prNumber = github.context.payload.pull_request?.number;
    if (!prNumber) {
      throw new Error('Could not get PR number from the context; this action should only be run on pull_request events.');
    }

    const { owner, repo } = github.context.repo;
    const { data: fileList } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    const changedFiles = fileList.map(file => file.filename);

    console.log(`\nAll changed files ${changedFiles}`);
    
    // Use glob.sync to synchronously match files against the pattern
    const matchedFiles = glob.sync(pattern, { nodir: true });

    // Filter matchedFiles to include only those that are also in changedFiles
    const filesToPrint = matchedFiles.filter(file => changedFiles.includes(file));

    for (const file of filesToPrint) {
      console.log(`\nContent of ${file}:`);
      const content = await fs.readFile(file, 'utf8');
      console.log(content);
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
