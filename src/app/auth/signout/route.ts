import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function signOut(request: NextRequest, reason?: string | null) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const url = new URL('/login', request.url)
  if (reason === 'inactive') url.searchParams.set('error', 'This account has been deactivated. Contact your administrator.')
  return NextResponse.redirect(url, { status: 303 })
}

export async function POST(request: NextRequest) {
  return signOut(request)
}

// Used only to sign out deactivated accounts automatically.
export async function GET(request: NextRequest) {
  return signOut(request, request.nextUrl.searchParams.get('reason'))
}
