import { defineConfig, bindings } from "cf/config";

export default defineConfig({
  worker: {
    "name": "job-market-statistics",
    "entrypoint": "./worker.mjs",
    "env": { "SNAPSHOTS": bindings.kv({ id: "9ac51f6864024e18b574d2dc3473f333" }), "ASSETS": bindings.assets() },
    "compatibilityDate": "2026-10-06",
    "domains": ["statistics.jobs.explosion.fun", "statistics-jobs.explosion.fun"],
    "observability": {
      "enabled": true
    },
    "assets": {
      "notFoundHandling": "single-page-application", "runWorkerFirst": ["/snapshot.json", "/internal/refresh"]
    }
  }
});
