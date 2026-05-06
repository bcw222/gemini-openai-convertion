import { createServerAdapter } from "@whatwg-node/server";
import { createServer } from "node:http";
import worker from "./src/worker.mjs";

const port = +(process.env.PORT || 8080);

console.log("GEMINI_BASE_URL:", process.env.GEMINI_BASE_URL || "(default)");
console.log("PORT:", port);
console.log("NODE_ENV:", process.env.NODE_ENV || "(unset)");

const serverAdapter = createServerAdapter(worker.fetch);
const server = createServer(serverAdapter);
server.listen(port, () => {
  console.log("Listening on:", server.address());
});
