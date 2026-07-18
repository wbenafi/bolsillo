import { SignIn } from "@clerk/nextjs";
import { PiggyBank } from "lucide-react";

export default function SignInPage() {
  return <main className="auth-page"><section className="auth-intro"><span className="brand-mark"><PiggyBank /></span><p className="eyebrow">Bolsillo</p><h1>Sabé siempre cuánto queda.</h1><p>Un lugar tranquilo para separar el dinero de cada proyecto y registrar lo que entra y sale.</p></section><SignIn /></main>;
}
