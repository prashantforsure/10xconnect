"use client";

import { useEffect, useState } from "react";

// Landing page for the Hosted Auth popup. It signals the opener (the Settings →
// Accounts tab) that the flow finished, then closes itself. Public (no auth) —
// see PUBLIC_PATHS in lib/supabase/middleware.ts.
export default function ConnectCallbackPage() {
  const [closed, setClosed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("status") ?? "success";
    setFailed(status === "failure");
    if (window.opener) {
      window.opener.postMessage(
        { source: "10xconnect-hosted-auth", status },
        window.location.origin,
      );
    }
    // Give the message a tick to deliver, then close. If the browser blocks
    // window.close() (e.g. tab wasn't script-opened), show a manual hint.
    const t = window.setTimeout(() => {
      window.close();
      setClosed(true);
    }, 300);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <div>
        <p className="font-display text-lg font-semibold">
          {failed ? "LinkedIn connection didn't finish" : "LinkedIn connected"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {failed
            ? "The login was cancelled or hit a checkpoint. Close this tab and try again from 10xConnect."
            : closed
              ? "You can close this tab and return to 10xConnect."
              : "Finishing up — this window will close automatically."}
        </p>
      </div>
    </main>
  );
}
