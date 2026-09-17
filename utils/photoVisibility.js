/**
 * Rules engine for AfterGlow Photo Visibility (Sprint X2)
 */

/**
 * Resolve the photo access level for a given user and party.
 * 
 * @param {String|null} reqUserId - The ID of the user requesting access (can be null for anonymous).
 * @param {Object} party - The party document (lean or model).
 * @param {Object|null} hostUser - The host User document (lean or model) containing the `friends` array.
 * @returns {String} 'full' | 'cover-only' | 'nothing'
 */
export function resolvePhotoAccess(reqUserId, party, hostUser) {
  const hostId = party.hostUserId?.toString();
  const visibility = party.afterglowVisibility || party.visibility || 'private';
  
  // 1. Si user est l'host de la party → 'full'
  if (reqUserId && hostId && reqUserId === hostId) {
    return 'full';
  }

  // 2. Si !party.afterglowSaved → 'nothing' (soirée non archivée)
  // Note: default in schema is true. If it's explicitly false, we hide it.
  if (party.afterglowSaved === false) {
    return 'nothing';
  }

  // 3. Si party.afterglowVisibility === 'invisible' → 'nothing'
  if (visibility === 'invisible') {
    return 'nothing';
  }

  // 4. Si user est participant de la party → 'full'
  if (reqUserId && (party.participants || []).some(p => 
    p.userId?.toString() === reqUserId || 
    p.id?.toString() === reqUserId || 
    p.userId === reqUserId || 
    p.id === reqUserId
  )) {
    return 'full';
  }

  // 5. Si party.afterglowVisibility === 'public' → 'cover-only'
  if (visibility === 'public') {
    return 'cover-only';
  }

  // 6. Si party.afterglowVisibility === 'friends' ET user est ami de host → 'cover-only'
  if (visibility === 'friends' && reqUserId && hostUser && Array.isArray(hostUser.friends)) {
    const isFriend = hostUser.friends.some(f => f.userId?.toString() === reqUserId);
    if (isFriend) {
      return 'cover-only';
    }
  }

  // 7. Sinon → 'nothing'
  return 'nothing';
}

/**
 * Filter the photos array based on the access level.
 * 
 * @param {Array} photos - The array of photo objects.
 * @param {String} accessLevel - The access level resolved by resolvePhotoAccess ('full' | 'cover-only' | 'nothing').
 * @param {String|null} coverPhotoId - The ID of the cover photo.
 * @returns {Array} The filtered photos array.
 */
export function filterPhotosForUser(photos, accessLevel, coverPhotoId) {
  if (accessLevel === 'full') {
    return photos;
  }
  
  if (accessLevel === 'cover-only') {
    if (!coverPhotoId) {
      // Fallback: If no cover photo is designated, we could return the most recent one or none.
      // Returning the most recent photo is a safe fallback to avoid empty state if allowed to see cover.
      return photos.length > 0 ? [photos[0]] : [];
    }
    const coverPhoto = photos.find(p => p._id?.toString() === coverPhotoId?.toString() || p.id?.toString() === coverPhotoId?.toString());
    return coverPhoto ? [coverPhoto] : (photos.length > 0 ? [photos[0]] : []);
  }
  
  return []; // 'nothing'
}
