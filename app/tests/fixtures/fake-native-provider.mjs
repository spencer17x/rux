import { createServer } from "node:http";

const port = Number(process.argv[2] || 48765);
let responseSequence = 0;

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function sse(response, events) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  let index = 0;
  const timer = setInterval(() => {
    const event = events[index++];
    if (!event) {
      clearInterval(timer);
      response.end();
      return;
    }
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }, 90);
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") {
    json(response, 200, { object: "list", data: [{ id: "fake-native-model", object: "model" }] });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/responses") {
    json(response, 404, { error: { message: "Not found" } });
    return;
  }

  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      json(response, 400, { error: { message: "Invalid JSON" } });
      return;
    }
    if (body.model !== "fake-native-model" || body.stream !== true) {
      json(response, 400, { error: { message: "Expected fake-native-model with stream=true" } });
      return;
    }

    responseSequence += 1;
    const id = `fake-native-response-${responseSequence}`;
    const input = Array.isArray(body.input) ? body.input : [];
    const toolOutput = input.find((item) => item?.type === "function_call_output");
    if (!toolOutput) {
      const item = {
        type: "function_call",
        id: "write-item",
        call_id: "write-native-result",
        name: "write_file",
        arguments: JSON.stringify({ path: "native-result.txt", content: "native works" }),
      };
      sse(response, [
        { type: "response.created", response: { id } },
        { type: "response.output_item.done", item },
        { type: "response.completed", response: { id, output: [item], usage: { input_tokens: 18, output_tokens: 8, total_tokens: 26 } } },
      ]);
      return;
    }

    if (toolOutput.call_id === "write-native-result") {
      const item = {
        type: "function_call",
        id: "command-item",
        call_id: "verify-native-result",
        name: "run_command",
        arguments: JSON.stringify({
          executable: "node",
          args: ["-e", "const fs=require('node:fs');if(fs.readFileSync('native-result.txt','utf8')!=='native works')process.exit(2);console.log('verified')"],
          timeout_ms: 10_000,
        }),
      };
      sse(response, [
        { type: "response.created", response: { id } },
        { type: "response.output_item.done", item },
        { type: "response.completed", response: { id, output: [item], usage: { input_tokens: 9, output_tokens: 9, total_tokens: 18 } } },
      ]);
      return;
    }

    sse(response, [
      { type: "response.created", response: { id } },
      { type: "response.output_text.delta", item_id: "final-message", delta: "Rux Native 已完成文件写入，" },
      { type: "response.output_text.delta", item_id: "final-message", delta: "并通过受限命令验证。" },
      { type: "response.completed", response: {
        id,
        output: [{ type: "message", id: "final-message", content: [{ type: "output_text", text: "Rux Native 已完成文件写入，并通过受限命令验证。" }] }],
        usage: { input_tokens: 11, output_tokens: 12, total_tokens: 23 },
      } },
    ]);
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`fake-native-provider ready http://127.0.0.1:${port}/v1\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
