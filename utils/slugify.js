/**
 * utils/slugify.js
 * ★ B2.1: Generate URL-safe handles from user names.
 * Produces kebab-case, ASCII-only, max 30 chars.
 */

/**
 * Convert a name to a URL-safe handle.
 * @param {string} name - The user's first name or full name.
 * @returns {string} A kebab-case, ASCII-only handle (max 30 chars).
 */
export function generateHandle(name) {
  if (!name || typeof name !== 'string') return '';
  
  return name
    .normalize('NFD')                       // Decompose accents (é → e + ́)
    .replace(/[\u0300-\u036f]/g, '')        // Strip combining diacritical marks
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')           // Remove non-alphanumeric except spaces/hyphens
    .replace(/[\s_]+/g, '-')                // Spaces/underscores → hyphens
    .replace(/-+/g, '-')                    // Collapse multiple hyphens
    .replace(/^-|-$/g, '')                  // Trim leading/trailing hyphens
    .slice(0, 30);                          // Max 30 chars
}

/**
 * Generate a unique handle for a user, handling collisions with -2, -3, etc.
 * @param {import('mongoose').Model} UserModel - Mongoose User model
 * @param {string} baseName - The user's name to generate from
 * @param {string} [fallbackId] - Fallback userId hex if all suffixes are taken
 * @returns {Promise<string>} A unique handle
 */
export async function generateUniqueHandle(UserModel, baseName, fallbackId) {
  const base = generateHandle(baseName);
  if (!base) {
    return fallbackId ? fallbackId.toString().slice(-8) : `user-${Date.now()}`;
  }
  
  // Try base handle first
  const existing = await UserModel.findOne({ 'profile.handle': base }).select('_id').lean();
  if (!existing) return base;
  
  // Try suffixed versions -2 through -10
  for (let i = 2; i <= 10; i++) {
    const candidate = `${base.slice(0, 27)}-${i}`;  // Keep within 30 chars
    const exists = await UserModel.findOne({ 'profile.handle': candidate }).select('_id').lean();
    if (!exists) return candidate;
  }
  
  // Fallback: use userId hex suffix
  if (fallbackId) {
    return `${base.slice(0, 21)}-${fallbackId.toString().slice(-8)}`;
  }
  
  return `${base}-${Date.now().toString(36)}`;
}
