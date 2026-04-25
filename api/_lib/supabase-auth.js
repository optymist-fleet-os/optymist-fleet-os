const SUPABASE_URL = 'https://tegravrxaqcuktwjanzm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_FWerGr6XL94LiVQs2Lel-A_2M3sTKIu';

async function requireAuth(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = String(authHeader).startsWith('Bearer ')
    ? String(authHeader).slice(7).trim()
    : '';

  if (!token) {
    const error = new Error('Missing auth token.');
    error.statusCode = 401;
    throw error;
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const error = new Error('Unauthorized.');
    error.statusCode = 401;
    throw error;
  }

  return response.json();
}

module.exports = {
  requireAuth
};
