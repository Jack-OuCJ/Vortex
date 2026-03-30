import { createClient } from "@/lib/supabase/server";
import HomeClient from "./page.client";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <HomeClient user={user} />;
}
