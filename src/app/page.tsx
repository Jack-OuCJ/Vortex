import { createClient } from "@/lib/supabase/server";
import HomeClient from "./page.client";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: {
    email: string | null;
    username: string | null;
    avatar_url: string | null;
    ai_balance: number | null;
    max_ai_balance: number | null;
  } | null = null;

  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("email, username, avatar_url, ai_balance, max_ai_balance")
      .eq("id", user.id)
      .maybeSingle();

    profile = data ?? null;
  }

  return <HomeClient user={user} profile={profile} />;
}
