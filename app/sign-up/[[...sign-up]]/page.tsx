import { SignUp } from "@clerk/nextjs";

import { BrandIcon } from "@/components/brand-icon";
import { clerkAppearance } from "@/lib/brand";

export default function SignUpPage() {
  return <main className="auth-page"><section className="auth-intro"><BrandIcon className="auth-brand-icon" priority /><p className="eyebrow">Bolsillo</p><h1>Creá un bolsillo para cada propósito.</h1><p>Empezá en minutos y mantené cada saldo claro, sin hojas de cálculo.</p></section><SignUp appearance={clerkAppearance} /></main>;
}
