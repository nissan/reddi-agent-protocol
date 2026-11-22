import { redirect } from "next/navigation";

/**
 * The buyer dashboard is My jobs: it shows an example before sign-in and the
 * wallet's own paid calls after. This route stays so older links keep working.
 */
export default function BuyerDashboardPage() {
  redirect("/jobs");
}
