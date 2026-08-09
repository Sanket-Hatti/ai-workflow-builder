'use client'

import { useState } from 'react'
import { useSignInEmailPassword } from '@nhost/react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { signInEmailPassword, isLoading, isError, error } = useSignInEmailPassword()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = await signInEmailPassword(email, password)
    if (result.isSuccess) {
      router.push('/')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 p-6">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border px-3 py-2"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border px-3 py-2"
          required
        />
        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {isLoading ? 'Signing in...' : 'Sign in'}
        </button>
        {isError && (
          <p className="text-sm text-red-600">{error?.message}</p>
        )}
      </form>
    </div>
  )
}