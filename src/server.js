import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { settings } from "./config/settings.js";
import { openDatabase } from "./models/database.js";

export async function start(config = settings()) {
  const db = await openDatabase(config);
  const { app, reconcilePayments } = createApp(db, config);
  try {
    await reconcilePayments();
    const server = await new Promise((resolve, reject) => {
      const listener = app.listen(config.port, config.host, () => resolve(listener));
      listener.once("error", reject);
    });
    let processing = false;
    const worker = setInterval(async () => {
      if (processing) return;
      processing = true;
      try { await reconcilePayments(); }
      catch (error) { console.error("Payment reconciliation failed", error.name, error.code || ""); }
      finally { processing = false; }
    }, 5000);
    worker.unref();
    const port = server.address().port;
    const target = new URL("/v1/health", process.env.RENDER_EXTERNAL_URL || "http://127.0.0.1:" + port);
    const ping = () => fetch(target).catch(() => {});
    ping();
    const keepalive = setInterval(ping, 4 * 60 * 1000);
    keepalive.unref();
    const close = async () => {
      clearInterval(worker);
      clearInterval(keepalive);
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await db.close();
    };
    return { server, close };
  } catch (error) {
    await db.close();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const config = settings();
    const { server, close } = await start(config);
    console.log("Arghya API listening on http://" + config.host + ":" + server.address().port);
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => close().catch(() => { process.exitCode = 1; }));
  } catch (error) {
    console.error("Arghya API could not start: " + error.message);
    process.exitCode = 1;
  }
}
