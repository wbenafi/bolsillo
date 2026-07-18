import { SignUp } from "@clerk/nextjs";
import { PiggyBank } from "lucide-react";

export default function SignUpPage() {
  return <main className="auth-page"><section className="auth-intro"><span className="brand-mark"><PiggyBank /></span><p className="eyebrow">Bolsillo</p><h1>Creá un bolsillo para cada propósito.</h1><p>Empezá en minutos y mantené cada saldo claro, sin hojas de cálculo.</p></section><SignUp /></main>;
}
