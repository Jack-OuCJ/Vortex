import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_AVATAR_URL =
  "https://rmjacyfbivgftfgxymbm.supabase.co/storage/v1/object/public/avatars/Gemini_Generated_Image_nishebnishebnish.png";

function buildGoogleDefaultAvatarSvg(letter: string) {
  const safeLetter = (letter || "A").toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="128" fill="#000000"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="120" fill="#FFFFFF">${safeLetter}</text></svg>`;
}

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

        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("avatar_url")
          .eq("id", user.id)
          .maybeSingle();

        let avatarUrl = existingProfile?.avatar_url ?? DEFAULT_AVATAR_URL;

        if (provider === "google") {
          const avatarPath = `${user.id}/google-default.svg`;
          const initial = displayName[0] ?? "A";
          const svgContent = buildGoogleDefaultAvatarSvg(initial);

          const { error: uploadError } = await supabase.storage
            .from("avatars")
            .upload(avatarPath, svgContent, {
              contentType: "image/svg+xml",
              upsert: true,
            });

          if (!uploadError) {
            const { data } = supabase.storage
              .from("avatars")
              .getPublicUrl(avatarPath);
            avatarUrl = data.publicUrl;
          }
        }

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
