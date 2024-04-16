/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;
}

// Structure is defined in https://www.bytebase.com/docs/change-database/webhook/#custom
interface WebhookBody {
	level: string;
	activity_type: string;
	title: string;
	description: string;
	link: string;
	creator_id: number;
	creator_name: string;
	creator_email: string;
	created_ts: number;
	issue: {
		id: number;
		name: string;
		status: string;
		type: string;
		description: string;
	};
	project: {
		id: number;
		name: string;
	};
}

interface WebhookResponse {
	code: number;
	message: string;
}

function jsonResponse(data: WebhookResponse): Response {
	return new Response(JSON.stringify(data), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
		},
	});
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method === 'POST') {
			// Attempt to parse the POST request body as JSON
			try {
				const body: WebhookBody = await request.json();
				console.debug(body);

				const summary = `Received webhook for issue ${body.issue.name} with type ${body.issue.type} status ${body.issue.status}.`;
				return new Response(JSON.stringify({ code: 0, message: summary }), {
					status: 200,
					headers: {
						'Content-Type': 'application/json',
					},
				});
			} catch (error) {
				return jsonResponse({ code: 400, message: 'Invalid JSON' });
			}
		} else {
			// Handle other HTTP methods or return a method not allowed error
			return jsonResponse({ code: 405, message: 'Method Not Allowed' });
		}
	},
};
