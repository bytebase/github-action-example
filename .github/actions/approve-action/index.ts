import * as core from '@actions/core';

async function run(): Promise<void> {
  try {
    const input = core.getInput('myInput', { required: true });
    console.log(`Hello ${input}!`);
    core.setOutput('myOutput', `Hello ${input}!`);
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
