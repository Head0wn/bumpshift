import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import { createServer } from "node:http";
import { RaceRoom } from "./RaceRoom.js";

const app = express();
app.disable("x-powered-by");
app.get("/health", (_request, response) => {
  response.json({
    game: "BUMPSHIFT",
    status: "ok",
    transport: "colyseus"
  });
});

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer
  })
});
gameServer.define("race", RaceRoom).filterBy(["trackId"]);

const port = Number.parseInt(process.env.PORT ?? "2567", 10);
await gameServer.listen(Number.isFinite(port) ? port : 2567);
