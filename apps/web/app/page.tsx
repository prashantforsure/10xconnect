import { redirect } from "next/navigation";

export default function RootPage() {
  // Authenticated users land on the dashboard; middleware handles the logged-out case.
  redirect("/dashboard");
}
