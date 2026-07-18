import { SignIn } from "@clerk/nextjs";

import { BrandIcon } from "@/components/brand-icon";
import { clerkAppearance } from "@/lib/brand";

export default function SignInPage() {
  return <main className="auth-page"><section className="auth-intro"><BrandIcon className="auth-brand-icon" priority /><p className="eyebrow">Bolsillo</p><h1>Sabé siempre cuánto queda.</h1><p>Un lugar tranquilo para separar el dinero de cada proyecto y registrar lo que entra y sale.</p></section><SignIn appearance={clerkAppearance} /></main>;
}
