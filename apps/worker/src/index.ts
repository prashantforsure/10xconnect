import { env } from "@10xconnect/config";

/**
 * Worker entry point. In later phases this process hosts BullMQ consumers for the
 * dispatch engine (rate governor, scheduler, sequence engine). For Step 1 it simply
 * starts up and idles to prove the runtime + workspace wiring.
 */
function main(): void {
  console.log("worker up");
  console.log(`worker environment: ${env.NODE_ENV}`);

  // Keep the process alive. BullMQ consumers will replace this heartbeat later.
  setInterval(() => {
    // Intentionally empty: idle heartbeat placeholder.
  }, 60_000);
}

main();
