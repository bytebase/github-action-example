import * as core from '@actions/core';

async function run(): Promise<void> {
  const url = core.getInput("url", { required: true });
  const serviceAccount = core.getInput("service-account", { required: true });
  const serviceAccountKey = core.getInput("service-account-key", { required: true });
  const extraHeaders: string = core.getInput('headers');

  let headers: HeadersInit = extraHeaders ? JSON.parse(extraHeaders) : {};
  headers = {
    "Content-Type": "application/json",
    ...headers
  };

  const loginRequest = {
    email: serviceAccount,
    password: serviceAccountKey,
  };

  const loginRes = await fetch(`${url}/v1/auth/login`, {
    method: "POST",
    body: JSON.stringify(loginRequest),
    headers,
  });
  const loginResData = await loginRes.json();
  if (!loginResData.token) {
    throw new Error("Failed to obtain token for user: " + serviceAccount + ". Please check the service account and key.");
  }

  core.info("Login successful for user: " + serviceAccount + ". Token obtained.")
  core.setOutput('token', loginResData.token); 
}

run();
