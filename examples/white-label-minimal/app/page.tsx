import { getSessionUser } from "../lib/auth";
import GoogleSignInButton from "../components/GoogleSignInButton";
import SunnyLogo from "@/components/SunnyLogo";
import Workspace from "../components/Workspace";

export default async function Page() {
  const user = await getSessionUser();
  if (!user)
    return (
      <main className="login-page">
        <div className="login-card">
          <SunnyLogo className="sunny-logo" />
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
