import cron from "node-cron";
import { uploadDueVideos } from "@/lib/pipeline";
import { errorMessage } from "@/lib/types";

const timezone = process.env.TIMEZONE || "Asia/Kolkata";

cron.schedule(
  "* * * * *",
  async () => {
    try {
      const result = await uploadDueVideos();
      if (result.uploaded || result.failed) {
        console.log(
          `[autotube] uploaded=${result.uploaded} failed=${result.failed} skipped=${result.skipped}`,
        );
      }
    } catch (error) {
      console.error(`[autotube] tick failed: ${errorMessage(error)}`);
    }
  },
  { timezone, noOverlap: true },
);

console.log(`[autotube] cron secret: ${process.env.CRON_SECRET}`);
console.log(`[autotube] worker watching upload slots (${timezone})`);
