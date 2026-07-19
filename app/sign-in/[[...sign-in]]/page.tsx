import { SignIn } from "@clerk/nextjs";

import { BrandIcon } from "@/components/brand-icon";
import { clerkAppearance } from "@/lib/brand";

export default function SignInPage() {
  return <main className="auth-page"><section className="auth-intro"><BrandIcon className="auth-brand-icon" priority /><p className="eyebrow">Bolsillo</p><h1>Tu dinero, claro y en su lugar.</h1><p>Creá un bolsillo para cada propósito y registrá fácilmente lo que entra y sale.</p></section><SignIn appearance={clerkAppearance} /></main>;
}
