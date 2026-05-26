"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useSession, signOut as nextSignOut } from "next-auth/react";

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  beta_features: string[];
}

interface AuthContextValue {
  user: { id: string; email: string; name?: string | null; image?: string | null; twoFactorEnabled?: boolean } | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`/api/profile?userId=${userId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data) {
        setProfile({
          ...data,
          beta_features: data.beta_features ?? [],
        });
      }
    } catch (err) {
      console.error("[AuthProvider] fetchProfile threw:", err);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;

    if (session?.user) {
      fetchProfile(session.user.id);
    } else {
      setProfile(null);
      setProfileLoading(false);
    }
  }, [session, status, fetchProfile]);

  const signOut = useCallback(async () => {
    await nextSignOut();
    setProfile(null);
    window.location.href = "/login";
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session?.user?.id) return;
    await fetchProfile(session.user.id);
  }, [session?.user?.id, fetchProfile]);

  const user = session?.user ?? null;

  return (
    <AuthContext.Provider
      value={{
        user: user ? { id: user.id, email: user.email!, name: user.name, image: user.image, twoFactorEnabled: (user as { twoFactorEnabled?: boolean }).twoFactorEnabled } : null,
        profile,
        loading: status === "loading",
        profileLoading,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
    };
  }
  return ctx;
}
