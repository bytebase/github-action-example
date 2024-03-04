import * as core from '@actions/core';

async function run(): Promise<void> {
  const endpoint = core.getInput("endpoint", { required: true })
  const service_account = core.getInput("service_account", { required: true })
  const service_account_key = core.getInput("service_account_key", { required: true })

  let headers = {
    "Content-Type": "application/json",
    "Accept-Encoding": "deflate, gzip",
    // "CF-Access-Client-Id": core.getInput("zerotrust_bytebase_client_id", { required: true }),
    // "CF-Access-Client-Secret": core.getInput("zerotrust_bytebase_client_secret", { required: true }),
  };

  const loginRequest = {
    email: service_account,
    password: service_account_key,
  };

  const loginRes = await fetch(`${endpoint}/auth/login`, {
    method: "POST",
    body: JSON.stringify(loginRequest),
    headers,
  });
  const loginResData = await loginRes.json();
  if (!loginResData.token) {
    throw new Error("Failed to generate token for user: " + service_account + ". Please check the service account and key.");
  }
  
  return loginResData.token;
}

run();
