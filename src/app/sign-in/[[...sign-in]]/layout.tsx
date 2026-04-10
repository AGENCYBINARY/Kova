/** Clerk SignIn must not be statically prerendered without a provider/key at build time. */
export const dynamic = 'force-dynamic'

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children
}
