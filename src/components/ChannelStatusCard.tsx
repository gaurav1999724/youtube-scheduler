import { TvMinimalPlay } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ChannelStatusCard({
  connected,
  channelTitle,
  channelId,
}: {
  connected: boolean;
  channelTitle: string;
  channelId: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <TvMinimalPlay className="h-5 w-5 text-primary" />
            YouTube channel
          </CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {connected ? channelTitle : "Not connected"}
          </p>
        </div>
        <Badge variant={connected ? "success" : "secondary"}>{connected ? "Connected" : "Offline"}</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {connected
            ? `Uploads go to channel ${channelId}.`
            : "Connect the channel in Settings before the worker can publish."}
        </p>
      </CardContent>
    </Card>
  );
}
