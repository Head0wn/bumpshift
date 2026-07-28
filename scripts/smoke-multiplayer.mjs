import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client, getStateCallbacks } from "@colyseus/sdk";

const PORT = 2577;
const URL = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ["apps/server/dist/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(PORT)
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

const stopServer = async () => {
  if (server.exitCode !== null) {
    return;
  }
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(2000)
  ]);
  if (server.exitCode === null) {
    server.kill("SIGKILL");
  }
};

try {
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${URL}/health`);
      healthy = response.ok;
      if (healthy) {
        break;
      }
    } catch {
      // Le serveur est encore en train de démarrer.
    }
    await delay(100);
  }

  if (!healthy) {
    throw new Error(`Le serveur n'a pas démarré.\n${serverOutput}`);
  }

  const client = new Client(URL);
  const room = await client.joinOrCreate("race", {
    name: "Smoke Pilot"
  });
  const callbacks = getStateCallbacks(room);
  const localUpdates = [];

  callbacks(room.state).players.onAdd((player, playerId) => {
    if (playerId !== room.sessionId) {
      return;
    }
    const capture = () => {
      localUpdates.push({
        x: player.x,
        z: player.z,
        speed: player.speed,
        acknowledged: player.lastProcessedInput
      });
    };
    capture();
    callbacks(player).onChange(capture);
  });

  for (let sequence = 1; sequence <= 45; sequence += 1) {
    room.send("input", {
      sequence,
      throttle: 1,
      brake: 0,
      steer: 0,
      drift: false
    });
    await delay(12);
  }

  await delay(650);
  const first = localUpdates[0];
  const latest = localUpdates.at(-1);

  if (!first || !latest) {
    throw new Error("Aucun état joueur n'a été synchronisé.");
  }
  if (latest.acknowledged < 40) {
    throw new Error(
      `Le serveur n'a acquitté que l'entrée ${latest.acknowledged}.`
    );
  }
  if (latest.speed <= 2) {
    throw new Error(
      `Le kart n'a pas accéléré (vitesse ${latest.speed.toFixed(2)}).`
    );
  }
  if (Math.hypot(latest.x - first.x, latest.z - first.z) <= 1) {
    throw new Error("Le kart n'a pas avancé dans l'état autoritaire.");
  }

  await room.leave();
  console.log(
    JSON.stringify({
      room: "race",
      updates: localUpdates.length,
      acknowledgedInput: latest.acknowledged,
      speed: Number(latest.speed.toFixed(2)),
      moved: Number(
        Math.hypot(latest.x - first.x, latest.z - first.z).toFixed(2)
      )
    })
  );
} finally {
  await stopServer();
}

