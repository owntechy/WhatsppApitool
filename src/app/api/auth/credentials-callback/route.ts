import { signIn } from "@/auth";

export async function POST(request: Request) {
  try {
    const { loginToken } = await request.json();

    if (!loginToken) {
      return Response.json({ error: "Missing login token" }, { status: 400 });
    }

    await signIn("credentials", {
      loginToken,
      redirect: false,
    });

    return Response.json({ success: true });
  } catch (err) {
    console.error("[credentials-callback] signIn error:", err);
    return Response.json(
      { success: false, error: "Invalid or expired login token" },
      { status: 401 }
    );
  }
}
