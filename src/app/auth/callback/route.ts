import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_AVATAR_URL =
  "https://rmjacyfbivgftfgxymbm.supabase.co/storage/v1/object/public/avatars/Gemini_Generated_Image_nishebnishebnish.png";

function getGoogleDisplayName(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}) {
  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name.trim()
      : "";
  const name =
    typeof user.user_metadata?.name === "string"
      ? user.user_metadata.name.trim()
      : "";

  if (fullName) return fullName;
  if (name) return name;
  return user.email?.split("@")[0] ?? "Atoms_User";
}

function getGoogleAvatarUrl(user: { user_metadata?: Record<string, unknown> }) {
  const avatarUrl =
    typeof user.user_metadata?.avatar_url === "string"
      ? user.user_metadata.avatar_url.trim()
      : "";
  const pictureUrl =
    typeof user.user_metadata?.picture === "string"
      ? user.user_metadata.picture.trim()
      : "";

  return avatarUrl || pictureUrl || null;
}

function isLegacyGeneratedGoogleAvatar(url: string) {
  return (
    url.includes("/storage/v1/object/public/avatars/") &&
    url.endsWith("/google-default.svg")
  );
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Default redirect is to the main page /
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const provider = user.app_metadata?.provider;
        const displayName = getGoogleDisplayName(user);
        const profileEmail = user.email ?? null;
        const googleAvatarUrl =
          provider === "google" ? getGoogleAvatarUrl(user) : null;

        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("avatar_url")
          .eq("id", user.id)
          .maybeSingle();

        const existingAvatarUrl = existingProfile?.avatar_url?.trim() || null;
        const shouldUseGoogleAvatar =
          provider === "google" &&
          (!existingAvatarUrl ||
            existingAvatarUrl === DEFAULT_AVATAR_URL ||
            isLegacyGeneratedGoogleAvatar(existingAvatarUrl));

        const avatarUrl = shouldUseGoogleAvatar
          ? googleAvatarUrl ?? existingAvatarUrl ?? DEFAULT_AVATAR_URL
          : existingAvatarUrl ?? DEFAULT_AVATAR_URL;

        await supabase.from("profiles").upsert(
          {
            id: user.id,
            email: profileEmail,
            username: displayName,
            avatar_url: avatarUrl,
          },
          { onConflict: "id" },
        );
      }

      return NextResponse.redirect(`${origin}${next}`);
    } else {
      console.error("Auth callback error:", error);
    }
  }

  // Return the user to an error page or login with error query
  return NextResponse.redirect(`${origin}/login?error=Could not authenticate`);
}
