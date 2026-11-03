import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Dashboard } from "@/components/Dashboard";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");
  return <Dashboard />;
}
