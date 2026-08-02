#!/usr/bin/env node
/**
 * Transparent HTTP tap for transcript capture.
 *
 *   node tap.mjs <listen-port> <target-port> <log-file> [label]
 *
 * Forwards every request on 127.0.0.1:<listen-port> to 127.0.0.1:<target-port>
 * byte-for-byte and appends one JSON line per exchange to <log-file>. It sits
 * *between* the stock components rather than inside them, so the transcript is
 * evidence of what actually crossed the wire — neither the buyer, the seller, nor
 * the facilitator is modified or even aware of it.
 *
 * Header arrays are taken from `rawHeaders`, which preserves the exact casing as
 * sent — header-name casing is itself evidence (FACTS F-057).
 */
import http from "node:http";
import { appendFileSync } from "node:fs";

const [listenPort, targetPort, logFile, label = "tap"] = process.argv.slice(2);
if (!listenPort || !targetPort || !logFile) {
  console.error("usage: tap.mjs <listen-port> <target-port> <log-file> [label]");
  process.exit(1);
}

let seq = 0;

/** Collects a stream into a Buffer. */
function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", c => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/** Folds a rawHeaders array into [name, value] pairs, casing preserved. */
function pairs(raw) {
  const out = [];
  for (let i = 0; i < raw.length; i += 2) out.push([raw[i], raw[i + 1]]);
  return out;
}

const server = http.createServer(async (req, res) => {
  const exchange = {
    tap: label,
    seq: ++seq,
    at: new Date().toISOString(),
    request: {
      method: req.method,
      url: req.url,
      headers: pairs(req.rawHeaders),
      body: null,
    },
    response: null,
  };

  const requestBody = await collect(req);
  if (requestBody.length > 0) exchange.request.body = requestBody.toString("utf8");

  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: Number(targetPort),
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    async proxyRes => {
      const responseBody = await collect(proxyRes);
      exchange.response = {
        status: proxyRes.statusCode,
        headers: pairs(proxyRes.rawHeaders),
        body: responseBody.length > 0 ? responseBody.toString("utf8") : null,
      };
      appendFileSync(logFile, JSON.stringify(exchange) + "\n");
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      res.end(responseBody);
    },
  );
  upstream.on("error", err => {
    exchange.response = { status: 502, error: String(err) };
    appendFileSync(logFile, JSON.stringify(exchange) + "\n");
    res.writeHead(502);
    res.end("tap: upstream unreachable");
  });
  upstream.end(requestBody);
});

server.listen(Number(listenPort), "127.0.0.1", () => {
  console.log(`tap[${label}] 127.0.0.1:${listenPort} -> 127.0.0.1:${targetPort}, logging to ${logFile}`);
});
