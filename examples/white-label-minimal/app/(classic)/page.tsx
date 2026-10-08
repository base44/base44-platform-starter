import { redirect } from "next/navigation";
import { getSessionUser } from "../../server/auth";
import GoogleSignInButton from "../../client/components/GoogleSignInButton";
import TinySunnyLogo from "../../client/components/TinySunnyLogo";
import Workspace from "../../client/components/Workspace";

export default async function Page() {
  // TINY_SUNNY_LEAN=true shows the lean rewrite instead (app/(lean)/lean, code in lean/).
  if (process.env.TINY_SUNNY_LEAN === "true") redirect("/lean");
  const user = await getSessionUser();
  if (!user)
    return (
      <main className="login-page">
        <div className="login-card">
          <TinySunnyLogo />
          <h1>
            A little idea.
            <br />
            Your next app.
          </h1>
          <p>Build something useful. Make it yours.</p>
          <GoogleSignInButton />
        </div>
      </main>
    );
  return <Workspace name={user.name || user.email} />;
}
