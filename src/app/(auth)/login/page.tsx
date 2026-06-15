"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { MessageSquare, ArrowLeft } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login-validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      console.log(res)
     
      if (!res.ok) {
        let message = "Invalid email or password";
        try {
          const errData = await res.json();
          if (errData.error) message = errData.error;
        } catch {}
        setError(message);
        setLoading(false);
        return;
      }

      const data = await res.json();

      if (data.step === "2fa") {
        if (data.devOtp) {
          setDevOtp(data.devOtp);
        }
        setStep("otp");
        setLoading(false);
        return;
      }

      if (data.step === "signin" && data.loginToken) {
        const result = await signIn("credentials", {
          loginToken: data.loginToken,
          redirect: false,
        });
        console.log(result)
        alert("Hello")
        if (result?.ok) {
          window.location.href = "/dashboard";
          return;
        }

        setError("Invalid or expired login token. Please try again.");
        setLoading(false);
        return;
      }

      setError("Unexpected response");
      setLoading(false);
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const verifyRes = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });

      const verifyData = await verifyRes.json();

      if (!verifyRes.ok) {
        setError(verifyData.error || "Invalid or expired code");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/auth/login-validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signInToken: verifyData.signInToken }),
      });

      const data = await res.json();

      if (!res.ok || data.step !== "signin" || !data.loginToken) {
        setError("Something went wrong. Please try logging in again.");
        setStep("credentials");
        setLoading(false);
        return;
      }

      const result = await signIn("credentials", {
        loginToken: data.loginToken,
        redirect: false,
      });

      if (result?.ok) {
        window.location.href = "/dashboard";
        return;
      }

      setError("Something went wrong. Please try again.");
      setStep("credentials");
      setLoading(false);
      return;
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  };

  if (step === "otp") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <Card className="w-full max-w-md border-slate-800 bg-slate-900">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <MessageSquare className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-white">Two-factor authentication</CardTitle>
            <CardDescription className="text-slate-400">
              Enter the verification code sent to{" "}
              <strong className="text-slate-300">{email}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="relative">
            <form onSubmit={handleOtpSubmit} className="flex flex-col gap-4">
              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              {devOtp && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
                  [DEV MODE] Your OTP is:{" "}
                  <strong className="font-mono text-base">{devOtp}</strong>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="otp" className="text-slate-300">
                  Verification code
                </Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  required
                  disabled={loading}
                  className="border-slate-700 bg-slate-800 text-center text-2xl tracking-[8px] text-white placeholder:text-slate-500 focus-visible:border-primary focus-visible:ring-primary/20"
                />
              </div>

              <Button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Spinner /> Verifying...
                  </span>
                ) : (
                  "Verify"
                )}
              </Button>

              <button
                type="button"
                onClick={() => {
                  setStep("credentials");
                  setOtp("");
                  setError(null);
                  setDevOtp(null);
                }}
                className="flex items-center justify-center gap-1 text-sm text-slate-400 hover:text-slate-300"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to login
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <Card className="w-full max-w-md border-slate-800 bg-slate-900">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-white">Welcome back</CardTitle>
          <CardDescription className="text-slate-400">
            Sign in to your account
          </CardDescription>
        </CardHeader>
        <CardContent className="relative">
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-slate-300">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:border-primary focus-visible:ring-primary/20"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-slate-300">
                    Password
                  </Label>
                  <Link
                    href="/forgot-password"
                    className="text-sm text-primary hover:text-primary/80"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:border-primary focus-visible:ring-primary/20"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Spinner /> Signing in...
                  </span>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

          <p className="mt-6 text-center text-sm text-slate-400">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="text-primary hover:text-primary/80"
            >
              Create account
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
