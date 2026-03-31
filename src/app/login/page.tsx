"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { getBrowserSupabaseClient } from "@/lib/supabase-browser";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [showEmailFormatError, setShowEmailFormatError] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  const hasEmail = useMemo(() => Boolean(email.trim()), [email]);
  const isEmailValid = useMemo(() => EMAIL_REGEX.test(email.trim()), [email]);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        window.location.replace("/");
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        window.location.replace("/");
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorText("");
    setSuccessText("");

    if (!hasEmail) return;

    if (!isEmailValid) {
      setShowEmailFormatError(true);
      return;
    }

    setShowEmailFormatError(false);
    setIsSending(true);

    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setErrorText("Supabase 环境变量未配置完整");
      setIsSending(false);
      return;
    }

    const redirectTo = window.location.origin + "/auth/callback";

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    setIsSending(false);

    if (error) {
      if (error.message.includes("rate limit")) {
        setErrorText("验证邮件发送太频繁，请稍后再试");
      } else {
        setErrorText(error.message);
      }
      return;
    }

    setSuccessText("登录链接已发送，请检查邮箱");
  };

  const handleGoogleLogin = async () => {
    setErrorText("");
    setSuccessText("");
    setIsGoogleLoading(true);

    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setErrorText("Supabase 环境变量未配置完整");
      setIsGoogleLoading(false);
      return;
    }

    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });

    // 正常情况下会跳转到 Google 页面，回到本页面才需要复位 loading。
    if (error) {
      setErrorText(error.message || "Google 登录请求失败");
      setIsGoogleLoading(false);
      return;
    }

    setIsGoogleLoading(false);
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="absolute left-6 top-6">
        <Link
          href="/"
          className="inline-flex size-8 items-center justify-center rounded-full text-black/45 transition-colors hover:text-black"
          aria-label="返回首页"
        >
          <ArrowLeft className="size-5" />
        </Link>
      </div>

      <main className="flex min-h-screen w-full items-center justify-center px-4">
        <section className="w-full max-w-[340px]">
          <h1 className="text-center text-[26px] font-bold tracking-tight text-foreground/90">
            登录或注册
          </h1>
          <p className="mt-1.5 text-center text-[15px] font-medium text-muted-foreground">
            开始使用 Atoms 创作
          </p>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isSending || isGoogleLoading}
            className="mt-8 flex h-[44px] w-full items-center justify-center gap-2.5 rounded-[8px] border border-foreground/10 bg-background text-[14px] font-semibold text-foreground/75 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all hover:bg-foreground/5 disabled:cursor-not-allowed"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-[18px]"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {isGoogleLoading ? "跳转中..." : "使用 Google 继续"}
          </button>

          <div className="my-6 flex items-center gap-3 text-[12px] font-medium text-foreground/30">
            <span className="h-[1px] flex-1 bg-black/5" />
            或
            <span className="h-[1px] flex-1 bg-black/5" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setErrorText("");
                  setSuccessText("");
                  setShowEmailFormatError(false);
                }}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  setShowEmailFormatError(
                    Boolean(value) && !EMAIL_REGEX.test(value),
                  );
                }}
                placeholder="输入您的电子邮件地址"
                className={`h-[44px] w-full rounded-[8px] border bg-muted px-4 text-[14px] text-foreground/80 transition-colors outline-none placeholder:text-foreground/35 focus:bg-background ${
                  showEmailFormatError
                    ? "border-[#d04550] focus:border-[#d04550]"
                    : "border-black/5 focus:border-foreground/20"
                }`}
              />
              {showEmailFormatError ? (
                <p className="mt-1.5 text-[12px] font-medium text-[#d04550]">
                  无效电子邮件
                </p>
              ) : null}
            </div>

            <div>
              <p className="text-center text-[12px] leading-relaxed text-muted-foreground/80">
                继续即表示您同意我们的
                <span className="cursor-pointer font-medium underline underline-offset-2 hover:text-black/70 mx-1">
                  服务条款
                </span>
                和
                <span className="cursor-pointer font-medium underline underline-offset-2 hover:text-black/70 ml-1">
                  隐私政策
                </span>
                。
              </p>
            </div>

            {errorText ? (
              <p className="text-center text-[13px] font-medium text-[#d04550]">
                {errorText}
              </p>
            ) : null}
            {successText ? (
              <p className="text-center text-[13px] font-medium text-[#27824f]">
                {successText}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={!hasEmail || isSending}
              className={`h-[44px] w-full mt-2 flex items-center justify-center rounded-[8px] text-[15px] font-semibold transition-all duration-300 disabled:cursor-not-allowed ${
                hasEmail
                  ? "bg-black text-white enabled:hover:bg-black/85 shadow-[0_2px_4px_rgba(0,0,0,0.1)] hover:scale-[1.02]"
                  : "bg-muted-foreground/40 text-white/90"
              }`}
            >
              {isSending ? (
                <div className="flex items-center gap-2">
                  <div className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>处理中...</span>
                </div>
              ) : (
                "继续"
              )}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
