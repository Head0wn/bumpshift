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

const waitUntil = async (predicate, timeoutMilliseconds, message) => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(25);
  }
  throw new Error(message);
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

  const firstClient = new Client(URL);
  const secondClient = new Client(URL);
  const firstRoom = await firstClient.joinOrCreate("race", {
    name: "Smoke One"
  });
  const secondRoom = await secondClient.joinOrCreate("race", {
    name: "Smoke Two"
  });
  const callbacks = getStateCallbacks(firstRoom);
  const localUpdates = [];

  callbacks(firstRoom.state).players.onAdd((player, playerId) => {
    if (playerId !== firstRoom.sessionId) {
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

  await waitUntil(
    () => firstRoom.state.players.size === 2,
    2000,
    "Les deux pilotes n'ont pas rejoint le même salon."
  );

  firstRoom.send("ready", true);
  secondRoom.send("ready", true);

  await waitUntil(
    () => firstRoom.state.phase === "countdown",
    2000,
    "Le compte à rebours synchronisé n'a pas démarré."
  );
  await waitUntil(
    () =>
      firstRoom.state.phase === "racing" &&
      secondRoom.state.phase === "racing",
    5000,
    "La course n'a pas démarré sur les deux clients."
  );

  for (let sequence = 1; sequence <= 45; sequence += 1) {
    firstRoom.send("input", {
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

  await Promise.all([firstRoom.leave(), secondRoom.leave()]);
  console.log(
    JSON.stringify({
      room: "race",
      players: 2,
      synchronizedPhase: "racing",
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
