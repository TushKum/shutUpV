import { signOut } from "@/app/login/actions";

export function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form action={signOut}>
      <button type="submit" className={`text-sm underline underline-offset-2 ${className}`}>
        Sign out
      </button>
    </form>
  );
}
